/**
 * The issue lane: a slot directly under the stop bar, sharing its horizontal
 * frame, where located findings (a bracket over the offending segment, a ring
 * on the offending handle) will be drawn. For now it is an empty 12px track;
 * it is decorative until findings render, so it is hidden from assistive tech
 * (the findings themselves are listed, with text, in the score details).
 */
export function IssueLane() {
  return (
    <div className="issue-lane" aria-hidden="true" data-testid="issue-lane">
      <div className="issue-lane-track" />
    </div>
  );
}
