const plainObject = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Normalize representation only. Keep unknown fields and duplicate metadata so
// the ordinary strict schema still rejects them; never repair malformed JSON or
// modify a question, answer key, citation, or evidence identifier.
export function normalizeFinishArguments(value, { reasonField = false } = {}) {
  if (!plainObject(value)) return value;
  let assessment = value.assessment;
  if (typeof assessment === 'string') {
    try { assessment = JSON.parse(assessment); } catch { return value; }
  }
  if (!plainObject(assessment)) return value;
  const normalized = { ...value, assessment: { ...assessment } };
  for (const key of ['summary', 'evidenceIds']) {
    if (Object.hasOwn(assessment, key) && !Object.hasOwn(value, key)) {
      normalized[key] = assessment[key];
      delete normalized.assessment[key];
    }
  }
  // Small-change schemas carry noQuestionReason; when questions are asked it is
  // simply empty, so a model that omits it is not sent around a repair loop.
  if (reasonField && Array.isArray(normalized.assessment.questions) && normalized.assessment.questions.length && !Object.hasOwn(normalized.assessment, 'noQuestionReason')) normalized.assessment.noQuestionReason = '';
  return normalized;
}
