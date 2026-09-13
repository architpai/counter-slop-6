import { loadTacticalModels } from '@/engine/render/tactical';

// Browser tests use the same exported asset as the game, before constructing actors.
await loadTacticalModels();
