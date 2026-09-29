package mediasync.app.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import mediasync.core.DialTerminal
import mediasync.core.Endpoints
import mediasync.core.SyncMode

/**
 * Versioned user preferences. Only the per-model sync mode is stored; no
 * URLs, sessions or content ids survive process death (PRD-004-R07).
 */
class Preferences(private val context: Context) {
    private val store = context.getSharedPreferences("mediasync.preferences", Context.MODE_PRIVATE)

    init {
        if (store.getInt(SCHEMA_KEY, 0) < SCHEMA) migrate()
    }

    fun mode(terminal: DialTerminal): SyncMode =
        SyncMode.fromWire(store.getString(key(terminal), null)) ?: SyncMode.DEFAULT

    fun setMode(terminal: DialTerminal, mode: SyncMode) {
        store.edit().putString(key(terminal), mode.wireName).apply()
    }

    private fun key(terminal: DialTerminal) = Endpoints.preferenceKey(
        terminal.device.manufacturer, terminal.device.modelName, terminal.device.location)

    /**
     * Idempotent import of the React Native AsyncStorage modes (same package
     * id), so an in-place update keeps the user's choice (PRD-014-R04).
     */
    private fun migrate() {
        val editor = store.edit()
        val legacy = context.getDatabasePath("RKStorage")
        if (legacy.exists()) {
            runCatching {
                SQLiteDatabase.openDatabase(legacy.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
                    database.rawQuery("SELECT key, value FROM catalystLocalStorage WHERE key LIKE ?", arrayOf("$LEGACY_PREFIX%")).use { cursor ->
                        while (cursor.moveToNext()) {
                            val key = cursor.getString(0)
                            val value = cursor.getString(1)
                            if (key.length <= 512 && SyncMode.fromWire(value) != null && !store.contains(key)) editor.putString(key, value)
                        }
                    }
                }
            }
        }
        editor.putInt(SCHEMA_KEY, SCHEMA).apply()
    }

    private companion object {
        const val SCHEMA = 1
        const val SCHEMA_KEY = "schema"
        const val LEGACY_PREFIX = "@universal-mediasync/mode/v1/"
    }
}
