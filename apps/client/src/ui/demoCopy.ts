/**
 * The words of the demonstration licence: the countdown tag and the wishlist card (D-036, package D). Authored copy, pending developer review (docs/AI_CONTENT_REGISTER.md).
 * The Society is licensing you its civilisation by the minute, as it licenses everything else. All set as text, never markup.
 */
export const DEMO_TAG = "Demonstration licence";
export const DEMO_TAG_SR = (minutes: number): string => `${DEMO_TAG}: ${minutes} ${minutes === 1 ? "minute" : "minutes"} remaining`;
export const DEMO_OVER = "Licence expired";

export const WISHLIST_TITLE = "The Licence Has Expired";
export const WISHLIST_TAG = "Form 9 (Demonstration, Concluded)";
export const WISHLIST_BODY = [
  "The Society thanks you for your custom, your cooperation and the three villages you will not be hearing from.",
  "The full expedition has further shores, a second country with a very long order of precedence, and a Chamberlain who has been waiting six years for somebody to sign something.",
] as const;
export const WISHLIST_BUTTON = "Add it to the wish list";
export const WISHLIST_SOON = "The full game is coming. There is no store page yet, so there is nothing to click: the Society will announce it when it has something to bill.";
export const WISHLIST_BACK = "Return to the door";
