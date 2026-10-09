/**
 * The line has gone dead: the room was left for good (the server shut down, or the reconnection gave up). Without it the game kept drawing the last frame's HUD - a prompt, a revive bar,
 * the down card - frozen and with no word. The card says what happened and what was kept, and offers the way back to the front door. It uses the front door's working-card look
 * (style.css `.consult`, in its error state).
 */
export class LostLine {
  private root: HTMLElement | undefined;

  /** True once shown (a second leave event is the same news). */
  get shown(): boolean {
    return this.root !== undefined;
  }

  show(onBack: () => void): void {
    if (this.root) return;
    const root = document.createElement("div");
    root.className = "consult lostline";
    root.dataset.state = "error";
    root.innerHTML = `<div class="card panel" role="alertdialog" aria-labelledby="lost-head" aria-describedby="lost-body" tabindex="-1">
      <h2 id="lost-head">The line has gone dead</h2>
      <p id="lost-body">The connection to the game was lost. Your progress is saved; you start again at HQ.</p>
      <div class="actions"><button type="button" class="primary back">Back to the menu</button></div>
    </div>`;
    const back = root.querySelector<HTMLButtonElement>(".back")!;
    back.addEventListener("click", onBack);
    root.addEventListener("padback", onBack);
    document.body.append(root);
    this.root = root;
    back.focus();
  }

  dispose(): void {
    this.root?.remove();
    this.root = undefined;
  }
}

/** Close codes that are not news: we left on purpose (consented, normal, the page going away), or the demo's own close (its card is the Wishlist). */
export function lostLineFor(code: number, demoClose: number): boolean {
  return code !== 4000 && code !== 1000 && code !== 1001 && code !== demoClose;
}
