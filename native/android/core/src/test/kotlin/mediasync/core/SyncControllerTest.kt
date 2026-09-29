package mediasync.core

import java.io.File
import java.util.Locale
import kotlin.math.abs
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SyncControllerTest {
    @Test
    fun matchesJavaScriptReference() {
        val rows = File(System.getProperty("mediasync.syncVectors")).readLines().drop(1)
        assertTrue(rows.size > 900)
        val controller = SyncController()
        rows.forEachIndexed { index, row ->
            val fields = row.split('\t')
            assertEquals(10, fields.size)
            if (fields[1] == "1") controller.reset()
            val decision = controller.update(fields[2].toDouble(), fields[3].toDouble(), fields[4].toDouble())
            val context = "${fields[0]} row $index"
            assertEquals(fields[5], decision.action.name.lowercase(Locale.ROOT), context)
            assertEquals(fields[6].toDouble(), decision.rate, 1e-12, context)
            assertEquals(fields[7].toDouble(), decision.drift, 1e-12, context)
            assertEquals(fields[8].toDouble(), decision.filteredDrift, 1e-12, context)
            assertEquals(fields[9], controller.mode.name.lowercase(Locale.ROOT), context)
        }
    }

    @Test
    fun supportsCustomOptions() {
        val controller = SyncController(SyncController.Options(maxRateDelta = 0.01))
        assertEquals(1.01, controller.update(-1.0, 0.0).rate, 1e-12)
    }

    @Test
    fun seeksAndResets() {
        val controller = SyncController()
        controller.update(0.5, 0.0)
        assertEquals(SyncController.Action.SEEK, controller.update(100.0, 90.0).action)
        assertEquals(1.0, controller.currentRate)
        assertEquals(0.0, controller.filteredDrift)
        assertEquals(SyncController.Mode.LOCKED, controller.mode)
        controller.reset()
        assertNull(controller.filteredDrift)
        assertEquals(1.0, controller.currentRate)
    }

    @Test
    fun respectsLiveOverrideAndStrictThresholds() {
        val controller = SyncController()
        assertEquals(SyncController.Action.RATE, controller.update(3.0, 0.0, 5.0).action)
        controller.reset()
        assertEquals(SyncController.Action.RATE, controller.update(2.0, 0.0).action)
        controller.reset()
        assertEquals(SyncController.Action.NONE, controller.update(0.1, 0.0).action)
    }

    @Test
    fun staysLockedBetweenBands() {
        val controller = SyncController()
        repeat(10) {
            assertEquals(SyncController.Action.NONE, controller.update(0.04, 0.0).action)
        }
        assertEquals(SyncController.Mode.LOCKED, controller.mode)
    }

    @Test
    fun convergesAheadAndBehindWithOneStepDelay() {
        for (initialDrift in listOf(-0.3, 0.3)) {
            val controller = SyncController()
            var playerTime = 0.0
            var tvTime = -initialDrift
            var appliedRate = 1.0
            repeat(400) {
                val decision = controller.update(playerTime, tvTime)
                assertTrue(decision.rate in 0.95..1.05)
                assertTrue(decision.action != SyncController.Action.SEEK)
                playerTime += appliedRate * 0.1
                tvTime += 0.1
                appliedRate = decision.rate
                val drift = playerTime - tvTime
                assertTrue(if (initialDrift < 0) drift < 0.03 else drift > -0.03)
            }
            assertTrue(abs(playerTime - tvTime) < 0.025)
            assertEquals(1.0, controller.currentRate)
        }
    }

    @Test
    fun ignoresSmallJitter() {
        val controller = SyncController()
        repeat(100) { step ->
            assertEquals(
                SyncController.Action.NONE,
                controller.update(sin(step * 1.7) * 0.03, 0.0).action,
            )
        }
    }
}