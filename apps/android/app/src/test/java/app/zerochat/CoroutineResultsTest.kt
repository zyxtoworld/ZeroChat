package app.zerochat

import kotlinx.coroutines.CancellationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class CoroutineResultsTest {
    @Test
    fun runCatchingPreservingCancellationRethrowsCancellation() {
        val cancellation = CancellationException("cancelled")

        val thrown = assertThrows(CancellationException::class.java) {
            runCatchingPreservingCancellation<Unit> { throw cancellation }
        }

        assertSame(cancellation, thrown)
    }

    @Test
    fun runCatchingPreservingCancellationCapturesOrdinaryFailures() {
        val failure = IllegalStateException("failed")

        val result = runCatchingPreservingCancellation<Unit> { throw failure }

        assertSame(failure, result.exceptionOrNull())
    }

    @Test
    fun mapCatchingPreservingCancellationRethrowsTransformCancellation() {
        val cancellation = CancellationException("cancelled")

        val thrown = assertThrows(CancellationException::class.java) {
            Result.success("value").mapCatchingPreservingCancellation<String, Unit> {
                throw cancellation
            }
        }

        assertSame(cancellation, thrown)
    }

    @Test
    fun mapCatchingPreservingCancellationKeepsOrdinaryResultSemantics() {
        assertEquals(
            5,
            Result.success("value")
                .mapCatchingPreservingCancellation { it.length }
                .getOrThrow(),
        )
    }
}
