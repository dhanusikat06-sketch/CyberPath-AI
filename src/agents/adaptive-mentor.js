import { skills } from "../data.js";

export function mentorReply(message, state, result) {
  const text = message.toLowerCase();
  const latest = state.assessments?.[state.assessments.length - 1];
  const nextTask = result.roadmap.find((task) => !task.completed);
  if (/why|important|career|role|match/.test(text)) {
    const gap = result.career.gaps[0];
    return gap
      ? `${gap.name} is important for a ${result.career.career.title} because it is one of the role's stated requirements. Your current estimated proficiency is ${gap.proficiency}%, compared with a ${gap.required}% target. ${gap.activity}`
      : `Your current evidence meets the skill thresholds in this ${result.career.career.title} profile. Keep building practical evidence; a match score is an estimate, not a hiring or certification guarantee.`;
  }
  if (/assessment|score|test|poor|result/.test(text) && latest) {
    const lowSkill = Object.entries(latest.skillScores || {}).sort((a, b) => a[1] - b[1])[0];
    const skill = skills.find((item) => item.id === lowSkill?.[0]);
    return `Your latest assessment score was ${latest.score}%. ${skill ? `${skill.name} was your lowest category at ${lowSkill[1]}%. ${skill.beginner}` : ""} Revisit the related roadmap task, then use a simulated lab exercise to check your understanding.`;
  }
  if (/roadmap|next|study|learn|recommend|start/.test(text)) {
    return nextTask
      ? `Your next recommended step is "${nextTask.title}" for ${nextTask.skill}. ${nextTask.reason} Try this practical activity too: ${nextTask.practical}`
      : "Your current roadmap tasks are complete. Run a fresh assessment or choose another career goal to generate a new role-specific plan.";
  }
  if (/sql|injection/.test(text)) {
    return "SQL injection is a class of risk where untrusted input changes a database query's intended structure. Defenses include parameterized queries, least-privilege database accounts and safe error handling. Practice recognition only in an isolated training lab or explicitly authorized environment.";
  }
  if (/phish|email/.test(text)) {
    return "Look for unexpected urgency, mismatched sender details, unusual requests and links that do not match the claimed organization. Avoid interacting with suspicious content and report it through your organization's approved channel.";
  }
  if (/confidence|proof|verified|claim/.test(text)) {
    const mismatch = result.analysis.mismatches[0];
    return mismatch
      ? `Your ${mismatch.name} self-rating is ${mismatch.claimed}%, while demonstrated evidence averages ${mismatch.demonstrated}%. That difference is a learning signal, not a judgment. ${mismatch.activity}`
      : "Proof-of-Skill compares self-reported ratings with assessment and simulated lab results. Skills without evidence are clearly marked self-reported only; a quiz or lab score is not a professional certification.";
  }
  return `I use a deterministic, rule-based mentor in this local prototype—not an external language model. For your ${result.career.career.title} goal, your estimated match is ${result.career.score}%. ${nextTask ? `A useful next step is ${nextTask.title} (${nextTask.skill}).` : "Consider a new assessment or career goal to refresh your plan."} Ask me about your career match, assessment, roadmap, proof of skill, phishing or SQL injection.`;
}
