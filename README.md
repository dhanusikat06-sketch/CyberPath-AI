# CyberPath AI

A browser-based cybersecurity skill assessment and career-readiness prototype. It uses deterministic, explainable learning logic—not an external LLM—and stores profile and progress data in the current browser's `localStorage`.

## Run locally

From the project directory on Windows:

```powershell
py -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). If `py` is not available, use `python -m http.server 8000`. Stop the local server with `Ctrl+C`.

The app is dependency-free and does not require API keys, a database, a build step, or a paid service. A local HTTP server is recommended because the app uses JavaScript modules.

## Features

- **My Profile:** Edit learner details, skill claims, education, certifications, projects, preferences and career goal. Changes are saved locally.
- **My Account:** Open the clickable profile menu to view or edit learner details, skills, certifications, projects and profile completion. The menu supports keyboard navigation and closes on outside clicks.
- **Settings:** Persist display and learning preferences, select a roadmap focus category and difficulty target, export saved learner data as JSON, or clear demo data with confirmation. The dark theme is shown as fixed because no theme switch is supported.
- **Account Information and sign-out:** Account details are identified as a local demo profile, with no registered account or verified email. Sign Out ends the current tab's demo session without deleting data; the learner can resume it or clear the data in Settings.
- **Skill Analysis:** Combines self-reported skills with quiz and simulated lab results, showing strengths, gaps and claim/evidence mismatches.
- **Career Explorer:** Compares estimated skills with requirements for SOC Analyst, Penetration Tester, Security Engineer, Cloud Security Engineer and Digital Forensics Analyst.
- **Learning Roadmap:** Generates prioritized role-specific tasks and free learning links; completed tasks persist.
- **Learning Hub:** Preserves the 12-module SOC Analyst curriculum and adds paths for Penetration Tester (21 modules), Security Engineer (22), Cloud Security Engineer (24), and Digital Forensics Analyst (24). The first foundation module in each new path and Penetration Tester modules 2–5 are published; 8 of 91 career-path modules are available and the remaining 83 are explicitly planned. The new Penetration Tester modules have eight detailed topics, module-level objectives and review material, ten four-choice questions with explanations, safe exercises, and individual PDFs. Existing foundation modules remain intact. Cloud study material does not require a paid subscription or billable resources.
- **Progress Tracker:** Records assessments, practical challenge scores, completed tasks and learning activity; includes a score-history chart and proof-of-skill comparison.
- **AI Mentor:** Responds to profile-aware questions with transparent, deterministic rules. It does not claim to use an LLM.
- **Skill Assessment:** A 12-question quiz with answer validation, scoring and category evidence.
- **Cyber Lab:** Seven controlled, fictional exercises for phishing, input-pattern recognition, secure configuration, account hygiene, log triage and defensive review. Exercises do not connect to real systems.
- **AI Agent Center:** Five separate deterministic agent modules collaborate sequentially through `src/agents/orchestrator.js`. The live pipeline shows Waiting/Running/Completed/Failed states, actual agent inputs and outputs, hand-offs, timestamps and persisted activity history. Assessment, profile/career changes, and lab submissions launch workflows automatically. Lab results trigger skill, career and roadmap recalculation before the mentor responds.

## Data and privacy

The app saves data in `localStorage` under `cyberpath-ai-state-v1` in the browser used to access it. The signed-out marker is kept in tab-scoped `sessionStorage`. Data is not synchronized to a server. Use Settings to export or clear saved demo data; clearing browser site data also removes it. Resource links go to third-party sites; verify their current content and terms.

## Learning materials and PDFs

Open **Learning Hub** in the sidebar to choose a career path. The original 12-module SOC curriculum remains in `src/curriculum.json`; `src/career-curricula.json` outlines 91 modules across the four additional careers. Four existing foundations and Penetration Tester modules 2–5 are published; the other 83 career modules remain planned. Newly authored modules are not shown as available unless the curriculum schema is complete, including detailed lessons, a ten-question four-choice assessment, review material, and an individual PDF. Studied topics and latest quiz results persist in local browser storage; they are learning evidence, not mastery or professional credentials. Each published new-career module has a PDF under `learning-materials/<career-path>/`. Penetration-testing examples use authorized fictional environments, forensics examples use fictional data and preserve originals, and cloud foundation lessons avoid billable resources.

The SOC path continues to provide 12 individual PDFs in `learning-materials/`; modules 4-12 include common beginner mistakes and topic summaries, module 11 includes nine complete fictional SOC labs, and module 12 includes sample interview questions and answers. PDFs for the new career tracks are generated only for available modules; planned modules have no downloads.

The browser app itself remains dependency-free. To regenerate the PDFs, install the optional Python build dependency and run:

```powershell
py -m pip install -r requirements-pdf.txt
py scripts/generate_learning_pdfs.py
```

The generator validates SOC module ordering, all four career module counts and levels, unique identifiers, authored lesson fields, quiz-to-topic references, required module-level curriculum sections and assessment shape for newly authored modules, lab sections, and interview samples, then writes A4 PDFs only for available modules. Each generated file is checked for a PDF header and end marker.

## Current scope

This prototype has no FastAPI/Python backend or API endpoints, account system, remote database, LLM integration or cross-device synchronization. Its modules and agent logic run in JavaScript in the browser. Assessment and lab scores are educational signals, not professional certification or a guarantee of job readiness.
