/**
 * Filling a field in from a record without arguing with the person typing.
 *
 * Three situations, and only the middle one is obvious:
 *
 *   the field is empty              fill it in
 *   the field still holds what the  replace it, because that value belonged to
 *   last selection put there        a different selection and is now wrong
 *   the field holds something else  leave it alone; somebody typed that
 *
 * Getting the second case wrong is the quiet one. Pick the wrong participant,
 * notice, pick the right one - and the form keeps the first participant's
 * registration number, which then goes onto a grant agreement. No error, no
 * warning, and the number looks plausible because it is a real number belonging
 * to a real company.
 */
export function prefillValue(
  current: string,
  previousPrefill: string | null | undefined,
  nextPrefill: string | null | undefined
): string {
  if (current === '') return nextPrefill ?? ''
  if (current === (previousPrefill ?? '')) return nextPrefill ?? ''
  return current
}
