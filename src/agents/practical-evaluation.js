export function evaluateChallenge(challenge, submittedAnswer) {
  const correct = Number(submittedAnswer) === challenge.answer;
  return {
    correct,
    score: correct ? 100 : 0,
    explanation: challenge.explanation,
    skill: challenge.skill,
    challengeId: challenge.id,
  };
}
