import GameMount from '@/components/GameMount';

// A Server Component is fine here: GameMount renders only an empty canvas and
// HUD root on the server. The engine is imported inside an effect, client-only.
export default function Page() {
  return <GameMount />;
}
