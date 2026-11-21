import { STRATEGIES } from './lotto-strategies.js';
import { AUTO_CHAIN_ID, AUTO_CHAIN_NAME } from './chain-auto.js';

// The legacy nine-entry registry stays byte-for-byte stable for immutable
// predictions and their hashes. User-facing recommendations include #10.
export const RECOMMENDATION_STRATEGIES = Object.freeze([...STRATEGIES, [AUTO_CHAIN_ID, AUTO_CHAIN_NAME]]);
