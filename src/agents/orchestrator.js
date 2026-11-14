import { agentInfo } from "../data.js";
import { analyzeCareer } from "./career-intelligence.js";
import { generateRoadmap } from "./learning-path.js";
import { analyzeSkills, evaluateAssessment } from "./skill-assessment.js";
import { evaluateChallenge } from "./practical-evaluation.js";
import { mentorReply } from "./adaptive-mentor.js";

const now = () => new Date().toISOString();
const describe = (value) => typeof value === "string" ? value : JSON.stringify(value);

function createAgentRecord(agent, next) {
  return {
    id: agent.id,
    title: agent.title,
    status: "Waiting",
    input: "",
    task: agent.responsibility,
    analysis: "",
    output: "",
    next,
    startedAt: null,
    completedAt: null,
    error: "",
  };
}

function createWorkflow(state, trigger) {
  const agents = agentInfo.map((agent, index) => createAgentRecord(
    agent,
    index === 3 && trigger.startsWith("Cyber Lab")
      ? `${agentInfo[0].title} (recalculate evidence)`
      : index < agentInfo.length - 1 ? agentInfo[index + 1].title : "Learner dashboard and saved guidance",
  ));
  return {
    id: `agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    trigger,
    status: "Running",
    startedAt: now(),
    completedAt: null,
    careerGoal: state.profile.careerGoal,
    agents,
    executions: [...agents],
    error: "",
  };
}

function summarizeSkills(analysis) {
  return `${analysis.strong.length} strong; ${analysis.weak.length} developing; ${analysis.missing.length} not yet evidenced; ${analysis.mismatches.length} claim/evidence mismatch${analysis.mismatches.length === 1 ? "" : "es"}.`;
}

function summarizeCareer(career) {
  return `${career.score}% match for ${career.career.title}; ${career.gaps.length} required skill${career.gaps.length === 1 ? "" : "s"} below target.`;
}

function summarizeRoadmap(roadmap, career) {
  return `${roadmap.length} tasks prioritized for ${career.career.title}${roadmap[0] ? `, beginning with ${roadmap[0].skill}.` : "."}`;
}

function runPracticalAnalysis(state, challengeSubmission) {
  if (challengeSubmission) {
    const result = evaluateChallenge(challengeSubmission.challenge, challengeSubmission.answer);
    const savedResult = { ...result, date: now() };
    state.challenges.push(savedResult);
    return {
      result: savedResult,
      analysis: `${result.challengeId} checked against the exercise answer key; ${result.correct ? "correct" : "incorrect"} response.`,
      output: `${result.score}% on ${challengeSubmission.challenge.title}: ${result.explanation}`,
    };
  }
  const latest = state.challenges?.at(-1);
  return {
    result: null,
    analysis: latest ? `Reviewed saved simulated evidence for ${latest.challengeId} (${latest.score}%).` : "No new challenge submission; reviewed available simulated challenge evidence.",
    output: latest
      ? `Latest practical evidence: ${latest.score}% for ${latest.challengeId}. ${latest.correct ? "Correct response." : "Review the explanation and retry a related exercise."}`
      : "No practical challenge has been submitted yet; existing skill evidence was retained.",
  };
}

function executeStage(state, run, index, input, task, execute, onUpdate) {
  const record = run.agents[index];
  record.status = "Running";
  record.input = describe(input);
  record.task = task;
  record.startedAt = now();
  onUpdate?.(run);

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const result = execute();
        record.analysis = result.analysis;
        record.output = result.output;
        record.status = "Completed";
        record.completedAt = now();
        onUpdate?.(run);
        resolve(result.value);
      } catch (error) {
        record.status = "Failed";
        record.error = error instanceof Error ? error.message : String(error);
        record.analysis = "Agent execution failed.";
        record.output = record.error;
        record.completedAt = now();
        run.status = "Failed";
        run.error = record.error;
        run.completedAt = now();
        onUpdate?.(run);
        reject(error);
      }
    }, 100);
  });
}

function executeRecalculation(state, run, agentId, input, task, execute, onUpdate) {
  const definition = agentInfo.find((agent) => agent.id === agentId);
  const next = {
    assessment: `${agentInfo.find((agent) => agent.id === "career").title} (recalculate match)`,
    career: `${agentInfo.find((agent) => agent.id === "learning").title} (regenerate roadmap)`,
    learning: agentInfo.find((agent) => agent.id === "mentor").title,
  }[agentId] || "Continue updated evidence workflow";
  const record = createAgentRecord(definition, next);
  run.executions.push(record);
  record.status = "Running";
  record.input = describe(input);
  record.task = task;
  record.startedAt = now();
  onUpdate?.(run);

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const result = execute();
        Object.assign(record, {
          analysis: result.analysis,
          output: result.output,
          status: "Completed",
          completedAt: now(),
        });
        onUpdate?.(run);
        resolve(result.value);
      } catch (error) {
        record.status = "Failed";
        record.error = error instanceof Error ? error.message : String(error);
        record.analysis = "Agent execution failed.";
        record.output = record.error;
        record.completedAt = now();
        run.status = "Failed";
        run.error = record.error;
        run.completedAt = now();
        onUpdate?.(run);
        reject(error);
      }
    }, 100);
  });
}

export async function executeCollaboration(state, {
  trigger = "Manual analysis",
  assessment = null,
  challengeSubmission = null,
  onUpdate,
} = {}) {
  const run = createWorkflow(state, trigger);
  state.agentRuns ||= [];
  state.agentRuns.unshift(run);
  state.agentRuns = state.agentRuns.slice(0, 20);
  state.currentAgentRunId = run.id;
  onUpdate?.(run);

  let assessmentResult = null;
  let skillAnalysis = null;
  let careerAnalysis = null;
  let roadmap = null;
  let practicalResult = null;
  let guidance = "";

  try {
    await executeStage(
      state, run, 0,
      assessment
        ? { answerCount: Object.keys(assessment.answers).length, questionCount: assessment.questions.length }
        : { profileSkills: Object.keys(state.profile.skills || {}).length, assessmentCount: state.assessments.length, challengeCount: state.challenges.length },
      "Evaluate submitted answers when present, then combine profile claims with saved assessment and practical evidence.",
      () => {
        if (assessment) {
          const evaluated = evaluateAssessment(assessment.answers, assessment.questions);
          const result = { ...evaluated, answers: { ...assessment.answers }, careerGoal: state.profile.careerGoal, date: now() };
          state.assessments.push(result);
          assessmentResult = result;
        }
        skillAnalysis = analyzeSkills(state);
        return {
          value: skillAnalysis,
          analysis: `${summarizeSkills(skillAnalysis)} Overall skill score ${skillAnalysis.score}%.`,
          output: assessmentResult ? `Assessment scored ${assessmentResult.score}% (${assessmentResult.correct}/${assessmentResult.total}); skill analysis updated.` : `Skill analysis updated from ${state.assessments.length} assessment(s), ${state.challenges.length} challenge(s), and the learner profile.`,
        };
      },
      onUpdate,
    );

    careerAnalysis = await executeStage(
      state, run, 1,
      { careerGoal: state.profile.careerGoal, overallSkillScore: assessmentResult ? skillAnalysis.score : assessmentResult?.score ?? skillAnalysis.score },
      "Compare assessed skill proficiency with the selected career framework and calculate role-specific gaps.",
      () => {
        careerAnalysis = analyzeCareer(state, skillAnalysis);
        return { value: careerAnalysis, analysis: summarizeCareer(careerAnalysis), output: `${careerAnalysis.achieved.length} of ${careerAnalysis.skills.length} role requirements meet their target.` };
      },
      onUpdate,
    );

    roadmap = await executeStage(
      state, run, 2,
      { career: careerAnalysis.career.title, missingSkills: careerAnalysis.gaps.map((skill) => skill.name) },
      "Prioritize role-specific skill gaps and generate a phase-based roadmap with relevant learning resources.",
      () => {
        roadmap = generateRoadmap(state, careerAnalysis);
        return { value: roadmap, analysis: summarizeRoadmap(roadmap, careerAnalysis), output: roadmap.map((task) => `${task.skill}: ${task.title}`).join("; ") || "No roadmap tasks required." };
      },
      onUpdate,
    );

    practicalResult = await executeStage(
      state, run, 3,
      challengeSubmission
        ? { challenge: challengeSubmission.challenge.title, answer: challengeSubmission.answer }
        : { savedChallengeCount: state.challenges.length, trigger },
      "Evaluate a new simulated challenge submission, or review the latest saved challenge evidence.",
      () => {
        const practical = runPracticalAnalysis(state, challengeSubmission);
        return { ...practical, value: practical.result || practical };
      },
      onUpdate,
    );

    if (challengeSubmission) {
      skillAnalysis = await executeRecalculation(
        state, run, "assessment",
        { practicalEvidenceAdded: practicalResult.score, challenge: challengeSubmission.challenge.title },
        "Recalculate demonstrated proficiency using the newly saved practical evaluation result.",
        () => {
          skillAnalysis = analyzeSkills(state);
          return {
            value: skillAnalysis,
            analysis: `Recalculated after practical evidence. ${summarizeSkills(skillAnalysis)} Overall skill score ${skillAnalysis.score}%.`,
            output: `Skill analysis incorporated the ${practicalResult.score}% ${challengeSubmission.challenge.title} result.`,
          };
        },
        onUpdate,
      );
      careerAnalysis = await executeRecalculation(
        state, run, "career",
        { careerGoal: state.profile.careerGoal, updatedSkillScore: skillAnalysis.score },
        "Recalculate career match and role gaps using skill proficiency updated by the challenge result.",
        () => {
          careerAnalysis = analyzeCareer(state, skillAnalysis);
          return {
            value: careerAnalysis,
            analysis: summarizeCareer(careerAnalysis),
            output: `Career match recalculated to ${careerAnalysis.score}% after practical evidence; ${careerAnalysis.achieved.length} of ${careerAnalysis.skills.length} requirements meet target.`,
          };
        },
        onUpdate,
      );
      roadmap = await executeRecalculation(
        state, run, "learning",
        { career: careerAnalysis.career.title, updatedGaps: careerAnalysis.gaps.map((skill) => skill.name) },
        "Regenerate roadmap after incorporating the latest simulated challenge performance into career gaps.",
        () => {
          roadmap = generateRoadmap(state, careerAnalysis);
          return {
            value: roadmap,
            analysis: summarizeRoadmap(roadmap, careerAnalysis),
            output: `Roadmap regenerated from post-challenge evidence: ${roadmap.map((task) => `${task.skill}: ${task.title}`).join("; ") || "No roadmap tasks required."}`,
          };
        },
        onUpdate,
      );
    }

    guidance = await executeStage(
      state, run, 4,
      { career: careerAnalysis.career.title, careerMatch: careerAnalysis.score, assessmentScore: assessmentResult?.score ?? state.assessments.at(-1)?.score ?? null, latestPracticalScore: practicalResult?.score ?? state.challenges.at(-1)?.score ?? null, nextTask: roadmap.find((task) => !task.completed)?.title ?? null },
      "Synthesize skill, career, roadmap, assessment, and practical outputs into personalized next-step guidance.",
      () => {
        const text = mentorReply("What should I learn next?", state, { analysis: skillAnalysis, career: careerAnalysis, roadmap });
        state.agentMentorGuidance = { text, date: now(), workflowId: run.id };
        return { value: text, analysis: assessmentResult?.score < 60 ? "Recent assessment is below 60%; recommend foundational review and practice." : "Guidance is grounded in current role gaps, roadmap tasks, and learner evidence.", output: text };
      },
      onUpdate,
    );

    run.status = "Completed";
    run.completedAt = now();
    run.summary = `All ${run.agents.length} agents completed for ${careerAnalysis.career.title}.`;
    onUpdate?.(run);
    return { run, assessment: assessmentResult, skills: skillAnalysis, career: careerAnalysis, roadmap, practical: practicalResult, guidance };
  } catch (error) {
    run.status = "Failed";
    run.completedAt ||= now();
    run.error ||= error instanceof Error ? error.message : String(error);
    const failedRecord = run.executions.find((record) => record.status === "Failed")
      || run.executions.find((record) => record.status === "Running")
      || run.executions.find((record) => record.status === "Waiting");
    if (failedRecord && failedRecord.status !== "Failed") {
      failedRecord.status = "Failed";
      failedRecord.error = run.error;
      failedRecord.analysis = "Agent execution failed.";
      failedRecord.output = run.error;
      failedRecord.completedAt = now();
    }
    onUpdate?.(run);
    throw error;
  }
}

export function runAgents(state) {
  const analysis = analyzeSkills(state);
  const career = analyzeCareer(state, analysis);
  const roadmap = generateRoadmap(state, career);
  const recentAssessment = state.assessments?.[state.assessments.length - 1];
  const poorResult = recentAssessment && recentAssessment.score < 60;
  const outputs = {
    assessment: `${analysis.strong.length} strong skills, ${analysis.weak.length + analysis.missing.length} skills to build, ${analysis.mismatches.length} claim/evidence mismatch${analysis.mismatches.length === 1 ? "" : "es"}.`,
    career: `${career.score}% match for ${career.career.title}; ${career.gaps.length} role requirement${career.gaps.length === 1 ? "" : "s"} need attention.`,
    learning: `Roadmap prioritized ${roadmap.length} tasks for ${career.career.title}${poorResult ? " and adjusted for your latest assessment" : ""}.`,
    evaluation: state.challenges?.length
      ? `Reviewed ${state.challenges.length} simulated challenge${state.challenges.length === 1 ? "" : "s"}; latest score ${state.challenges[state.challenges.length - 1].score}%.`
      : "Ready to evaluate safe, simulated challenge submissions.",
    mentor: poorResult ? "A recent result is below 60%; recommend reviewing the related fundamentals and retrying practice." : `Next, focus on ${roadmap[0]?.skill || "a role-aligned skill"} and add practical evidence.`,
  };
  return {
    analysis,
    career,
    roadmap,
    outputs,
    agents: agentInfo.map((agent) => ({ ...agent, output: outputs[agent.id] })),
    summary: `${agentInfo.length} specialized deterministic agents are available for collaboration.`,
  };
}

export { analyzeSkills, evaluateAssessment } from "./skill-assessment.js";
export { analyzeCareer } from "./career-intelligence.js";
export { generateRoadmap } from "./learning-path.js";
export { evaluateChallenge } from "./practical-evaluation.js";
export { mentorReply } from "./adaptive-mentor.js";
