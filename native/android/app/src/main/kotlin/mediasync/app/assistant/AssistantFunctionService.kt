package mediasync.app.assistant

import android.app.PendingIntent
import androidx.annotation.RequiresApi
import androidx.appfunctions.AppFunctionAppUnknownException
import androidx.appfunctions.AppFunctionDeclaration
import androidx.appfunctions.AppFunctionElementNotFoundException
import androidx.appfunctions.AppFunctionInvalidArgumentException
import androidx.appfunctions.AppFunctionNotSupportedException
import androidx.appfunctions.AppFunctionPermissionRequiredException
import androidx.appfunctions.AppFunctionSerializable
import androidx.appfunctions.AppFunctionService
import androidx.appfunctions.AppFunctionServiceEntryPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import mediasync.app.R
import mediasync.app.graph
import mediasync.core.SyncMode

/** A TV on the local network. */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class AssistantTv(
    /** Stable identifier of the TV; pass it to the other functions. */
    val id: String,
    /** Name the TV announces, to show or say to the user. */
    val name: String,
    /** Manufacturer and model, when the TV announces them. */
    val model: String?,
    /** Whether the TV offers synchronization; only these TVs can be connected to. */
    val syncCapable: Boolean,
)

/** Result of a TV search. */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class AssistantTvList(
    /** Localized sentence that summarizes the result for the user. */
    val summary: String,
    /** Every TV found, including the ones that do not offer synchronization. */
    val tvs: List<AssistantTv>,
)

/** A tool the companion web page of the TV programme offers. */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class AssistantCompanionTool(
    /** Name to pass to runCompanionTool. */
    val name: String,
    /** What the tool does, as written by the broadcaster's page. */
    val description: String,
    /** JSON Schema of the arguments object runCompanionTool expects. */
    val inputSchema: String,
)

/** Reply to a command, with a way to show its result in the app. */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class AssistantReply(
    /** Localized sentence for the user. */
    val message: String,
    /**
     * Opens the app on the TV screen, and on the companion page when the message asks to open the
     * app. The app cannot bring itself to the front from the background, so launch it when the user
     * wants to see the TV screen or when the message asks to open the app.
     */
    val openApp: PendingIntent?,
)

/** The companion page tools, or why they are not available yet. */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class AssistantCompanionTools(
    /** The tools; empty when the page offers none or is not open. */
    val tools: List<AssistantCompanionTool>,
    /** Localized sentence that summarizes the result for the user. */
    val message: String,
    /**
     * Set when the page is not open and the app is in the background: launch it to open the app
     * and the page, then call listCompanionTools again.
     */
    val openApp: PendingIntent?,
)

/**
 * App Functions (PRD-015) over [AssistantCommands]: Gemini and other agents with the platform
 * permission can find TVs, read the session status, connect, listen and stop. Replies are
 * localized sentences meant to be relayed to the user. The compiler generates the concrete
 * service declared in the manifest; the platform only binds it on Android 16+.
 */
@RequiresApi(36)
@AppFunctionServiceEntryPoint(
    serviceName = "MediaSyncAppFunctionService",
    appFunctionXmlFileName = "mediasync_app_functions",
)
abstract class AssistantFunctionService : AppFunctionService() {
    private val commands get() = applicationContext.graph.assistant

    /**
     * Searches the local network for TVs (HbbTV terminals) the user can synchronize this device
     * with, for example to listen to the TV audio privately. Takes a few seconds.
     *
     * @return the TVs found and a summary for the user.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun findTvs(): AssistantTvList = call {
        val tvs = commands.tvs(refresh = true)
        AssistantTvList(commands.tvsSummary(tvs), tvs.map { AssistantTv(it.id, it.name, it.model, it.syncCapable) })
    }

    /**
     * Tells which TV this device is connected to, the synchronization state, the audio or video
     * playing on this device and the companion web pages the TV offers.
     *
     * @return a localized description of the current state.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun getStatus(): String = call { commands.status() }

    /**
     * Connects to a TV and starts synchronizing with it.
     *
     * @param tvId identifier of the TV, as returned by findTvs.
     * @param compatibilityMode true to use the compatibility mode (App2App), false for native DVB-CSS;
     *   omit it to use the mode last used with that TV model.
     * @return a localized sentence with the result and an intent that shows the TV screen.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun connectToTv(tvId: String, compatibilityMode: Boolean? = null): AssistantReply = call {
        val message = commands.connect(tvId, compatibilityMode?.let { if (it) SyncMode.COMPAT else SyncMode.NATIVE })
        AssistantReply(message, commands.openIntent())
    }

    /**
     * Plays the TV audio on this device, synchronized with the TV, in the user's language when
     * the programme offers it; it keeps playing in the background. Connects first when needed.
     *
     * @param tvId identifier of the TV, as returned by findTvs; omit it to use the connected TV or
     *   the only TV that offers synchronization.
     * @param audioDescription true to play the programme's audio description (narration of the
     *   images for blind or partially sighted users), for example when the user asks to turn it on.
     * @return a localized sentence with the result and an intent that shows the TV screen.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun listenToTv(tvId: String? = null, audioDescription: Boolean? = null): AssistantReply = call {
        val id = tvId ?: commands.currentTvId ?: commands.compatibleTvs().let { capable ->
            capable.singleOrNull()?.id ?: throw AppFunctionInvalidArgumentException(
                applicationContext.getString(R.string.native_assistant_tvs_choose) + " " + capable.joinToString { "${it.name} (${it.id})" })
        }
        AssistantReply(commands.listen(id, audioDescription == true), commands.openIntent())
    }

    /**
     * Disconnects from the TV and stops playback on this device.
     *
     * @return a localized confirmation.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun stopSync(): String = call { commands.stop() }

    /**
     * Lists the tools of the companion web page of the programme on the TV: broadcasters use them
     * to answer questions about the programme or the schedule, show extra content or act on the
     * TV. Opens the page when the TV offers one and the app is visible; otherwise returns an
     * intent that opens it.
     *
     * @return the tools and a summary, or an intent to open the page first.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun listCompanionTools(): AssistantCompanionTools = call {
        try {
            val tools = commands.companionTools()
            AssistantCompanionTools(tools.map { AssistantCompanionTool(it.name, it.description, it.inputSchema.toString()) },
                commands.toolsSummary(tools), null)
        } catch (closed: AssistantCommands.Failure) {
            if (closed.reason != AssistantCommands.Reason.PAGE_CLOSED) throw closed
            AssistantCompanionTools(emptyList(), closed.message.orEmpty(), commands.openIntent(closed.pageUrl))
        }
    }

    /**
     * Runs a tool of the companion web page (see listCompanionTools) and returns its answer, for
     * example the reply of the broadcaster's assistant to a question about the programme.
     *
     * @param name name of the tool, as returned by listCompanionTools.
     * @param argumentsJson arguments as a JSON object that follows the tool's inputSchema; omit it
     *   when the tool takes no arguments.
     * @return the tool's answer as text; when the page is not open, a request to open the app
     *   with the intent that opens it.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun runCompanionTool(name: String, argumentsJson: String? = null): AssistantReply = call {
        try {
            AssistantReply(commands.runCompanionTool(name, argumentsJson), null)
        } catch (closed: AssistantCommands.Failure) {
            if (closed.reason != AssistantCommands.Reason.PAGE_CLOSED) throw closed
            AssistantReply(closed.message.orEmpty(), commands.openIntent(closed.pageUrl))
        }
    }

    /** Runs on the main thread, like the controllers, and maps failures to App Function errors. */
    private suspend fun <T> call(block: suspend () -> T): T = withContext(Dispatchers.Main) {
        try {
            block()
        } catch (failure: AssistantCommands.Failure) {
            throw when (failure.reason) {
                AssistantCommands.Reason.TV_NOT_FOUND, AssistantCommands.Reason.TOOL_NOT_FOUND, AssistantCommands.Reason.NO_PAGE ->
                    AppFunctionElementNotFoundException(failure.message.orEmpty())
                AssistantCommands.Reason.INVALID_ARGUMENTS -> AppFunctionInvalidArgumentException(failure.message.orEmpty())
                AssistantCommands.Reason.PERMISSION -> AppFunctionPermissionRequiredException(failure.message.orEmpty())
                AssistantCommands.Reason.NO_SYNC, AssistantCommands.Reason.NO_MODES -> AppFunctionNotSupportedException(failure.message.orEmpty())
                else -> AppFunctionAppUnknownException(failure.message.orEmpty())
            }
        }
    }
}
