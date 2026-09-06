import * as contentStrategy from './contentStrategy.js';
import * as scriptWriter from './scriptWriter.js';
import * as thumbnailDesigner from './thumbnailDesigner.js';
import * as seoOptimizer from './seoOptimizer.js';
import * as productionManagement from './productionManagement.js';
import * as publishingScheduling from './publishingScheduling.js';
import * as analytics from './analytics.js';

// The chain, in order. The last one (analytics) loops back into the first
// (strategy) via state.analytics.feedback.
export const AGENTS = [
  contentStrategy,
  scriptWriter,
  thumbnailDesigner,
  seoOptimizer,
  productionManagement,
  publishingScheduling,
  analytics,
];

export const byId = Object.fromEntries(AGENTS.map((a) => [a.meta.id, a]));

// Per-video pipeline order (excludes the channel-level strategy & analytics agents).
export const VIDEO_PIPELINE = [scriptWriter, thumbnailDesigner, seoOptimizer, productionManagement];

export function agentList() {
  return AGENTS.map((a) => a.meta);
}
