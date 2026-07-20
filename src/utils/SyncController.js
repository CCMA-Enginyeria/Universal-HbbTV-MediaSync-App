/**
 * Shared predictive drift controller used by both the native and web players.
 * The implementation lives beside the hosted web player so both runtimes load
 * the same state machine instead of maintaining separate algorithm ports.
 */
import SyncController from '../../www/hbbtv_examples/sync_webplayer/SyncController';

export default SyncController;
