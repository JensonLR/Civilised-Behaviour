import type { Scene } from "three";
import { decodeSpec, generateCharacter } from "@cb/procedural";
import { CharacterAnimator, buildCharacter, type CharacterRig, type ExpressionId } from "@cb/procedural/three";
import { FLAG } from "@cb/shared";

/**
 * A player's (or NPC's) visible body: an articulated rig built from an encoded look, plus its animator.
 * Rebuilds transparently if the look string changes (creator, campaign events like a new scar).
 */
export class CharacterActor {
  private rig!: CharacterRig;
  private anim!: CharacterAnimator;
  private currentLook = "";

  constructor(
    private readonly scene: Scene,
    look: string | undefined,
    private readonly fallbackSeed: number,
    private readonly outline = true,
  ) {
    this.build(look);
  }

  get root(): CharacterRig["root"] {
    return this.rig.root;
  }

  get animator(): CharacterAnimator {
    return this.anim;
  }

  get height(): number {
    return this.rig.proportions.totalHeight;
  }

  private build(look: string | undefined): void {
    const spec = (look ? decodeSpec(look) : undefined) ?? generateCharacter(this.fallbackSeed);
    const prev = this.rig?.root;
    const prevPos = prev?.position.clone();
    const prevYaw = prev?.rotation.y ?? 0;
    this.rig?.dispose();
    this.rig = buildCharacter(spec, { outline: this.outline });
    this.anim = new CharacterAnimator(this.rig);
    if (prevPos) {
      this.rig.root.position.copy(prevPos);
      this.rig.root.rotation.y = prevYaw;
    }
    this.scene.add(this.rig.root);
    this.currentLook = look ?? "";
  }

  setLook(look: string | undefined): void {
    if ((look ?? "") !== this.currentLook) this.build(look);
  }

  /** Poses the figure. `facing` radians (0 = -Z), `speed` m/s, `flags` = FLAG bits. */
  update(dt: number, x: number, y: number, z: number, facing: number, speed: number, flags: number, vy = 0): void {
    this.rig.root.position.x = x;
    this.rig.root.position.z = z;
    this.rig.root.rotation.y = facing;
    this.anim.setExpression((flags & FLAG.DOWNED) !== 0 ? "pain" : "neutral");
    this.anim.update(dt, { speed, flags, vy });
    // The animator overwrites root.position.y each update with its own offset (e.g. lift when lying down);
    // the ground height is added afterwards.
    this.rig.root.position.y += y;
  }

  setExpression(id: ExpressionId): void {
    this.anim.setExpression(id);
  }

  dispose(): void {
    this.rig.dispose();
  }
}
