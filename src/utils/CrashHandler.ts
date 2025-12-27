import { locationService } from '../services/LocationService';

/**
 * CrashHandler
 * 
 * Provides a safety net for the application. If the JS engine crashes, 
 * we attempt to restore the phone's ringer mode and stop the foreground 
 * service so the user isn't stuck in "Silent" mode indefinitely.
 */
class CrashHandler {
    private isInitialized = false;

    initialize() {
        if (this.isInitialized) return;

        const globalAny = global as any;
        const originalHandler = globalAny.ErrorUtils?.getGlobalHandler();

        if (globalAny.ErrorUtils) {
            globalAny.ErrorUtils.setGlobalHandler(async (error: any, isFatal?: boolean) => {
                console.error('[CrashHandler] Fatal error detected:', error);

                // Attempt emergency cleanup
                try {
                    await this.performEmergencyCleanup();
                } catch (cleanupError) {
                    console.error('[CrashHandler] Cleanup failed during crash:', cleanupError);
                }

                // Pass to original handler (usually shows the RedBox or crash screen)
                if (originalHandler) {
                    originalHandler(error, isFatal);
                }
            });
            this.isInitialized = true;
            console.log('[CrashHandler] Security global error handler initialized');
        }
    }

    private async performEmergencyCleanup() {
        console.log('[CrashHandler] Executing emergency cleanup...');
        
        // 1. Stop the foreground service and location monitoring
        await locationService.cleanupOnCrash();
        
        // Final log to console
        console.log('[CrashHandler] Emergency cleanup completed.');
    }
}

export const crashHandler = new CrashHandler();
