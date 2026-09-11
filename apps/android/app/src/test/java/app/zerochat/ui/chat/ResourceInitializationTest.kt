package app.zerochat.ui.chat

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class ResourceInitializationTest {
    @Test
    fun initializationFailureReleasesThePartiallyInitializedResource() {
        val resource = TestResource()
        val failure = IllegalStateException("prepare failed")

        val thrown = assertThrows(IllegalStateException::class.java) {
            initializeResourceOrRelease(
                resource = resource,
                release = { released = true },
                initialize = { throw failure },
            )
        }

        assertSame(failure, thrown)
        assertEquals(true, resource.released)
    }

    @Test
    fun releaseFailureIsSuppressedByTheInitializationFailure() {
        val failure = IllegalStateException("prepare failed")
        val releaseFailure = IllegalArgumentException("release failed")

        val thrown = assertThrows(IllegalStateException::class.java) {
            initializeResourceOrRelease(
                resource = TestResource(),
                release = { throw releaseFailure },
                initialize = { throw failure },
            )
        }

        assertSame(failure, thrown)
        assertSame(releaseFailure, thrown.suppressed.single())
    }

    private class TestResource {
        var released = false
    }
}
