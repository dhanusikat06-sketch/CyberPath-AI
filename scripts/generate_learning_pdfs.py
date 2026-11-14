import json
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
CURRICULUM_FILE = ROOT / "src" / "curriculum.json"
CAREER_CURRICULA_FILE = ROOT / "src" / "career-curricula.json"
OUTPUT_DIR = ROOT / "learning-materials"
INK = colors.HexColor("#142237")
MUTED = colors.HexColor("#52647b")
CYAN = colors.HexColor("#127f9e")
PALE = colors.HexColor("#edf7fa")
LINE = colors.HexColor("#d8e2eb")


def build_styles():
    base = getSampleStyleSheet()
    return {
        "cover": ParagraphStyle(
            "CoverTitle", parent=base["Title"], fontName="Helvetica-Bold",
            fontSize=25, leading=31, textColor=INK, alignment=TA_CENTER,
            spaceAfter=12,
        ),
        "subtitle": ParagraphStyle(
            "CoverSubtitle", parent=base["Normal"], fontSize=12, leading=18,
            textColor=MUTED, alignment=TA_CENTER, spaceAfter=12,
        ),
        "h1": ParagraphStyle(
            "ModuleHeading", parent=base["Heading1"], fontName="Helvetica-Bold",
            fontSize=17, leading=22, textColor=INK, spaceBefore=10, spaceAfter=10,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "TopicHeading", parent=base["Heading2"], fontName="Helvetica-Bold",
            fontSize=13, leading=17, textColor=CYAN, spaceBefore=12,
            spaceAfter=7, keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "SectionHeading", parent=base["Heading3"], fontName="Helvetica-Bold",
            fontSize=10, leading=13, textColor=INK, spaceBefore=7,
            spaceAfter=3, keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "LearningBody", parent=base["BodyText"], fontName="Helvetica",
            fontSize=9.4, leading=14, textColor=INK, spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "LearningSmall", parent=base["BodyText"], fontName="Helvetica",
            fontSize=8.2, leading=11, textColor=MUTED, spaceAfter=4,
        ),
        "bullet": ParagraphStyle(
            "LearningBullet", parent=base["BodyText"], fontName="Helvetica",
            fontSize=9.2, leading=13, textColor=INK, leftIndent=4, spaceAfter=3,
        ),
        "term": ParagraphStyle(
            "LearningTerm", parent=base["BodyText"], fontName="Helvetica",
            fontSize=8.5, leading=12, textColor=INK,
        ),
        "diagram": ParagraphStyle(
            "LearningDiagram", fontName="Courier", fontSize=7.6, leading=10,
            textColor=INK, backColor=PALE, borderColor=LINE, borderWidth=0.5,
            borderPadding=8, spaceBefore=4, spaceAfter=8,
        ),
        "code": ParagraphStyle(
            "LearningCode", fontName="Courier", fontSize=7.4, leading=10,
            textColor=INK, backColor=PALE, borderColor=LINE, borderWidth=0.5,
            borderPadding=7, spaceBefore=4, spaceAfter=8, wordWrap="CJK",
        ),
        "toc0": ParagraphStyle(
            "TOCLevel0", fontName="Helvetica-Bold", fontSize=9.5, leading=14,
            leftIndent=0, firstLineIndent=0, textColor=INK, spaceBefore=4,
        ),
        "toc1": ParagraphStyle(
            "TOCLevel1", fontName="Helvetica", fontSize=8.5, leading=12,
            leftIndent=14, firstLineIndent=0, textColor=MUTED,
        ),
        "quiz": ParagraphStyle(
            "QuizPrompt", parent=base["BodyText"], fontName="Helvetica-Bold",
            fontSize=9.4, leading=13, textColor=INK, spaceBefore=8, spaceAfter=4,
        ),
    }


class CurriculumDocTemplate(BaseDocTemplate):
    def __init__(self, filename, header_label, **kwargs):
        super().__init__(filename, **kwargs)
        self.header_label = header_label
        frame = Frame(
            self.leftMargin, self.bottomMargin, self.width, self.height,
            id="content", leftPadding=0, rightPadding=0, topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(PageTemplate(id="curriculum", frames=frame, onPage=self.draw_page))

    def draw_page(self, canvas, document):
        canvas.saveState()
        width, height = A4
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.6)
        canvas.line(18 * mm, height - 15 * mm, width - 18 * mm, height - 15 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, height - 12 * mm, f"CYBERPATH AI  |  {self.header_label.upper()}")
        canvas.line(18 * mm, 13 * mm, width - 18 * mm, 13 * mm)
        canvas.drawRightString(width - 18 * mm, 8.5 * mm, f"Page {document.page}")
        canvas.restoreState()

    def afterFlowable(self, flowable):
        key = getattr(flowable, "_bookmarkName", None)
        if not key:
            return
        level = getattr(flowable, "_tocLevel", 0)
        text = flowable.getPlainText()
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level, closed=False)
        self.notify("TOCEntry", (level, text, self.page, key))


def heading(text, style, key, level):
    paragraph = Paragraph(escape(text), style)
    paragraph._bookmarkName = key
    paragraph._tocLevel = level
    return paragraph


def paragraph(text, style):
    return Paragraph(escape(str(text)).replace("\n", "<br/>"), style)


def numbered_list(items, style):
    return [
        Paragraph(f"{index}. {escape(str(item))}", style)
        for index, item in enumerate(items, start=1)
    ]


def bullet_list(items, style):
    return [
        Paragraph(f"<bullet>&bull;</bullet>{escape(str(item))}", style)
        for item in items
    ]


def topic_story(topic, styles):
    story = [
        heading(topic["title"], styles["h2"], topic["id"], 1),
    ]
    if topic.get("objectives"):
        story.extend([
            paragraph("Learning objectives", styles["h3"]),
            *bullet_list(topic["objectives"], styles["bullet"]),
        ])
    story.extend([
        paragraph("In simple words: " + topic["definition"], styles["body"]),
        paragraph("How it works", styles["h3"]),
        paragraph(topic["explanation"], styles["body"]),
        paragraph("Why it matters", styles["h3"]),
        paragraph(topic["importance"], styles["body"]),
        paragraph("Step by step", styles["h3"]),
        *bullet_list(topic["steps"], styles["bullet"]),
        Spacer(1, 3),
    ])

    examples = [
        [paragraph("Everyday example", styles["h3"]), paragraph("Cybersecurity connection", styles["h3"])],
        [paragraph(topic["example"], styles["small"]), paragraph(topic["cyberExample"], styles["small"])],
    ]
    example_table = Table(examples, colWidths=[(A4[0] - 42 * mm) / 2] * 2, hAlign="LEFT")
    example_table.setStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ])
    story.extend([example_table, paragraph("Important terms", styles["h3"])])
    term_rows = [
        [Paragraph(f"<b>{escape(term['term'])}</b>", styles["term"]), paragraph(term["meaning"], styles["term"])]
        for term in topic["terms"]
    ]
    term_table = Table(term_rows, colWidths=[38 * mm, A4[0] - 80 * mm], hAlign="LEFT")
    term_table.setStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.35, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ])
    story.extend([
        term_table,
        paragraph("Visual guide", styles["h3"]),
        Preformatted(topic["diagram"], styles["diagram"]),
        paragraph("Safe practice", styles["h3"]),
        paragraph(topic["activity"], styles["body"]),
    ])
    if topic.get("exercise"):
        story.extend([
            paragraph("Step-by-step exercise", styles["h3"]),
            *numbered_list(topic["exercise"], styles["bullet"]),
        ])
    if topic.get("expected"):
        story.extend([
            paragraph("Expected observations", styles["h3"]),
            paragraph(topic["expected"], styles["body"]),
        ])
    if topic.get("keyPoints"):
        story.extend([
            paragraph("Key points", styles["h3"]),
            *bullet_list(topic["keyPoints"], styles["bullet"]),
        ])
    if topic.get("demonstration"):
        story.extend([
            paragraph("Demonstration", styles["h3"]),
            paragraph(topic["demonstration"], styles["code"]),
        ])
    if topic.get("mistakes"):
        story.extend([
            paragraph("Common beginner mistakes", styles["h3"]),
            paragraph(topic["mistakes"], styles["body"]),
        ])
    if topic.get("lab"):
        lab = topic["lab"]
        story.extend([
            paragraph("Lab exercise", styles["h3"]),
            paragraph("Objective: " + lab["objective"], styles["body"]),
            paragraph("Scenario: " + lab["background"], styles["body"]),
            paragraph("Tools: " + lab["tools"], styles["body"]),
            paragraph("Sample data", styles["h3"]),
            paragraph(lab["data"], styles["code"]),
            paragraph("Instructions", styles["h3"]),
            *numbered_list(lab["instructions"], styles["bullet"]),
            paragraph("Expected observations", styles["h3"]),
            *bullet_list(lab["observations"], styles["bullet"]),
            paragraph("Findings: " + lab["findings"], styles["body"]),
            paragraph("Conclusion: " + lab["conclusion"], styles["body"]),
            paragraph("Defensive recommendations: " + lab["recommendations"], styles["body"]),
        ])
    if topic.get("interview"):
        story.append(paragraph("Interview practice", styles["h3"]))
        for item in topic["interview"]:
            story.extend([
                paragraph("Question: " + item["question"], styles["quiz"]),
                paragraph("Sample answer: " + item["answer"], styles["body"]),
            ])
    if topic.get("summary"):
        story.extend([
            paragraph("Topic summary", styles["h3"]),
            paragraph(topic["summary"], styles["body"]),
        ])
    return story


def build_pdf(module, path, domain_title="SOC Analyst Foundations"):
    styles = build_styles()
    document = CurriculumDocTemplate(
        str(path), header_label=domain_title, pagesize=A4, rightMargin=21 * mm, leftMargin=21 * mm,
        topMargin=22 * mm, bottomMargin=20 * mm,
        title=module["title"], author="CyberPath AI",
        subject=f"Original {domain_title} study material",
    )
    story = [
        Spacer(1, 28 * mm),
        paragraph(f"{domain_title.upper()}  |  MODULE {module['number']:02d}  |  {module['difficulty'].upper()}", styles["subtitle"]),
        paragraph(module["title"], styles["cover"]),
        paragraph(module["description"], styles["subtitle"]),
        Spacer(1, 8 * mm),
        paragraph(f"Estimated study time: {format_minutes(module['estimatedMinutes'])}", styles["body"]),
        paragraph(
            "Original educational material. Examples and activities are for safe, authorized learning.",
            styles["body"],
        ),
        PageBreak(),
        paragraph("Contents", styles["h1"]),
    ]
    toc = TableOfContents()
    toc.levelStyles = [styles["toc0"], styles["toc1"]]
    toc.dotsMinLevel = 0
    story.extend([toc, PageBreak()])
    if module.get("learningIntroduction"):
        introduction = module["learningIntroduction"]
        story.append(heading("Module introduction", styles["h1"], f"introduction-{module['id']}", 0))
        for label, field in (
            ("In simple terms", "meaning"),
            ("Why learn this", "whyLearn"),
            ("How it is used in the role", "jobUse"),
            ("After this module", "outcomes"),
        ):
            story.extend([
                paragraph(label, styles["h3"]),
                paragraph(introduction[field], styles["body"]),
            ])
        story.append(heading("Module learning objectives", styles["h2"], f"objectives-{module['id']}", 1))
        story.extend(bullet_list(module["learningObjectives"], styles["bullet"]))
    for lesson in module["lessons"]:
        story.append(heading(lesson["title"], styles["h1"], lesson["id"], 0))
        for topic in lesson["topics"]:
            story.extend(topic_story(topic, styles))

    story.append(heading("Knowledge check", styles["h1"], f"quiz-{module['id']}", 0))
    story.append(paragraph(
        "Try each question before reading the answer. Viewing an answer does not indicate mastery.",
        styles["body"],
    ))
    for index, question in enumerate(module["quiz"], start=1):
        story.append(heading(f"Question {index}: {question['prompt']}", styles["h2"], question["id"], 1))
        story.extend(bullet_list(
            [f"{chr(65 + choice_index)}. {choice}" for choice_index, choice in enumerate(question["choices"])],
            styles["bullet"],
        ))
        story.append(paragraph(
            f"Answer: {question['choices'][question['answer']]}. {question['explanation']}",
            styles["body"],
        ))
        if question.get("distractorNote"):
            story.append(paragraph("Common misconception: " + question["distractorNote"], styles["small"]))
    if module.get("moduleSummary"):
        story.append(heading("Module summary", styles["h1"], f"summary-{module['id']}", 0))
        story.append(paragraph(module["moduleSummary"], styles["body"]))
        story.append(heading("Key concepts", styles["h2"], f"concepts-{module['id']}", 1))
        story.extend(bullet_list(module["keyConcepts"], styles["bullet"]))
        story.append(heading("Module glossary", styles["h1"], f"glossary-{module['id']}", 0))
        glossary_rows = [
            [Paragraph(f"<b>{escape(item['term'])}</b>", styles["term"]), paragraph(item["meaning"], styles["term"])]
            for item in module["glossary"]
        ]
        glossary = Table(glossary_rows, colWidths=[38 * mm, A4[0] - 80 * mm], hAlign="LEFT")
        glossary.setStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.35, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ])
        story.append(glossary)
        story.append(heading("Career interview questions", styles["h1"], f"interviews-{module['id']}", 0))
        for item in module["interviewQuestions"]:
            story.extend([
                paragraph("Question: " + item["question"], styles["quiz"]),
                paragraph("Sample answer: " + item["answer"], styles["body"]),
            ])
        story.append(heading("Revision topics", styles["h1"], f"revision-{module['id']}", 0))
        story.extend(bullet_list(module["revisionTopics"], styles["bullet"]))
    story.append(Spacer(1, 8))
    story.append(paragraph(
        "This material is educational. Follow your organization's policies and use only systems and data you are authorized to access.",
        styles["small"],
    ))
    document.multiBuild(story)


def format_minutes(minutes):
    hours, remainder = divmod(minutes, 60)
    return " ".join(
        part for part in (
            f"{hours} hr" if hours else "",
            f"{remainder} min" if remainder else "",
        ) if part
    )


def validate_curriculum(curriculum):
    modules = curriculum.get("modules", [])
    if len(modules) != 12 or [module.get("number") for module in modules] != list(range(1, 13)):
        raise SystemExit("The SOC path must contain modules numbered 1 through 12 in learning order.")

    identifiers = set()
    topic_fields = {
        "id", "title", "definition", "explanation", "importance", "steps",
        "example", "cyberExample", "terms", "diagram", "activity",
    }
    detailed_topic_fields = {"demonstration", "mistakes", "summary"}
    lab_fields = {
        "objective", "background", "tools", "data", "instructions", "observations",
        "findings", "conclusion", "recommendations",
    }
    for module in modules:
        module_id = module.get("id")
        if not module_id or module_id in identifiers:
            raise SystemExit(f"Missing or duplicate curriculum ID: {module_id}")
        identifiers.add(module_id)
        if module.get("status") == "planned":
            if module.get("lessons") or module.get("pdf"):
                raise SystemExit(f"Planned module {module['number']} must not ship placeholder lessons or a PDF.")
            continue
        if module.get("status") != "available":
            raise SystemExit(f"Unknown publication status for module {module['number']}.")
        if not module.get("estimatedMinutes", 0) > 0 or len(module.get("quiz", [])) < 5:
            raise SystemExit(f"Available module {module['number']} needs a study estimate and at least five questions.")
        if not module.get("lessons") or not module.get("pdf"):
            raise SystemExit(f"Available module {module['number']} is missing lessons or its PDF filename.")
        for lesson in module["lessons"]:
            lesson_id = lesson.get("id")
            if not lesson_id or lesson_id in identifiers:
                raise SystemExit(f"Missing or duplicate lesson ID: {lesson_id}")
            identifiers.add(lesson_id)
            for topic in lesson.get("topics", []):
                topic_id = topic.get("id")
                if not topic_id or topic_id in identifiers:
                    raise SystemExit(f"Missing or duplicate topic ID: {topic_id}")
                identifiers.add(topic_id)
                required_fields = topic_fields | (
                    detailed_topic_fields if module.get("number", 0) >= 4 else set()
                )
                missing = required_fields - topic.keys()
                if missing or len(topic.get("steps", [])) < 3 or not topic.get("terms"):
                    raise SystemExit(f"Incomplete topic {topic_id}: {', '.join(sorted(missing)) or 'steps or terms'}.")
                if module.get("number") == 11:
                    lab = topic.get("lab", {})
                    missing_lab = lab_fields - lab.keys()
                    if missing_lab or not lab.get("instructions") or not lab.get("observations"):
                        raise SystemExit(f"Incomplete SOC lab {topic_id}: {', '.join(sorted(missing_lab)) or 'instructions or observations'}.")
                for interview in topic.get("interview", []):
                    if not interview.get("question") or not interview.get("answer"):
                        raise SystemExit(f"Incomplete interview sample in {topic_id}.")
        for question in module["quiz"]:
            question_id = question.get("id")
            if not question_id or question_id in identifiers:
                raise SystemExit(f"Missing or duplicate quiz ID: {question_id}")
            identifiers.add(question_id)
            answer = question.get("answer", -1)
            if not 0 <= answer < len(question.get("choices", [])):
                raise SystemExit(f"Invalid answer index for {question_id}.")
    return identifiers


def validate_career_curricula(career_curricula, existing_identifiers):
    expected_counts = {
        "penetration-tester": 21,
        "security-engineer": 22,
        "cloud-security-engineer": 24,
        "digital-forensics-analyst": 24,
    }
    tracks = career_curricula.get("tracks", [])
    if [track.get("id") for track in tracks] != list(expected_counts):
        raise SystemExit("Career curricula must include the four requested tracks in their declared order.")

    identifiers = set(existing_identifiers)
    topic_fields = {
        "id", "title", "objectives", "definition", "explanation", "importance",
        "steps", "example", "cyberExample", "terms", "diagram", "demonstration",
        "exercise", "expected", "activity", "mistakes", "keyPoints", "summary",
    }
    for track in tracks:
        modules = track.get("modules", [])
        if len(modules) != expected_counts[track["id"]] or [module.get("number") for module in modules] != list(range(1, expected_counts[track["id"]] + 1)):
            raise SystemExit(f"{track['id']} must contain its numbered module list in order.")
        level_ids = {level.get("id") for level in track.get("levels", [])}
        if level_ids != {"beginner", "intermediate", "advanced"}:
            raise SystemExit(f"{track['id']} must define beginner, intermediate, and advanced levels.")
        if not track.get("careerId") or not track.get("title") or not track.get("description"):
            raise SystemExit(f"{track['id']} is missing its career mapping or description.")
        for module in modules:
            module_id = module.get("id")
            if not module_id or module_id in identifiers:
                raise SystemExit(f"Missing or duplicate career curriculum ID: {module_id}")
            identifiers.add(module_id)
            if module.get("level") not in level_ids:
                raise SystemExit(f"Unknown learning level for {module_id}.")
            if module.get("status") == "planned":
                if any(module.get(field) for field in ("lessons", "quiz", "pdf")):
                    raise SystemExit(f"Planned module {module_id} must not ship lessons, a quiz, or a PDF.")
                continue
            if module.get("status") != "available":
                raise SystemExit(f"Unknown publication status for {module_id}.")
            if not module.get("difficulty") or not module.get("estimatedMinutes", 0) > 0 or not module.get("pdf"):
                raise SystemExit(f"Available module {module_id} needs difficulty, study estimate, and PDF filename.")
            if len(module.get("quiz", [])) < 5 or not module.get("lessons"):
                raise SystemExit(f"Available module {module_id} needs complete lessons and at least five quiz questions.")
            if module["number"] > 1:
                introduction = module.get("learningIntroduction", {})
                introduction_fields = {"meaning", "whyLearn", "jobUse", "outcomes"}
                if introduction_fields - introduction.keys():
                    raise SystemExit(f"Module {module_id} is missing one or more module-introduction sections.")
                if not 4 <= len(module.get("learningObjectives", [])) <= 6:
                    raise SystemExit(f"Module {module_id} needs four to six learning objectives.")
                if not module.get("moduleSummary") or len(module.get("keyConcepts", [])) < 4:
                    raise SystemExit(f"Module {module_id} needs a summary and at least four key concepts.")
                glossary = module.get("glossary", [])
                if len(glossary) < 8 or any(not item.get("term") or not item.get("meaning") for item in glossary):
                    raise SystemExit(f"Module {module_id} needs at least eight complete glossary entries.")
                if len(module.get("interviewQuestions", [])) < 4 or len(module.get("revisionTopics", [])) < 4:
                    raise SystemExit(f"Module {module_id} needs four interview questions and four revision topics.")
                topics = [topic for lesson in module["lessons"] for topic in lesson.get("topics", [])]
                if not 8 <= len(topics) <= 12:
                    raise SystemExit(f"Module {module_id} needs between eight and twelve topics.")
                if len(module["quiz"]) < 10:
                    raise SystemExit(f"Module {module_id} needs at least ten knowledge-check questions.")
                if any(not question.get("distractorNote") for question in module["quiz"]):
                    raise SystemExit(f"Module {module_id} needs a common-misconception note for each quiz question.")
            topic_ids = set()
            for lesson in module["lessons"]:
                lesson_id = lesson.get("id")
                if not lesson_id or lesson_id in identifiers:
                    raise SystemExit(f"Missing or duplicate lesson ID: {lesson_id}")
                identifiers.add(lesson_id)
                if not lesson.get("topics"):
                    raise SystemExit(f"Lesson {lesson_id} has no topics.")
                for topic in lesson["topics"]:
                    topic_id = topic.get("id")
                    if not topic_id or topic_id in identifiers:
                        raise SystemExit(f"Missing or duplicate topic ID: {topic_id}")
                    identifiers.add(topic_id)
                    topic_ids.add(topic_id)
                    missing = topic_fields - topic.keys()
                    if missing or len(topic.get("objectives", [])) < 2 or len(topic.get("steps", [])) < 3 or len(topic.get("exercise", [])) < 2 or len(topic.get("keyPoints", [])) < 2 or not topic.get("terms"):
                        raise SystemExit(f"Incomplete career topic {topic_id}: {', '.join(sorted(missing)) or 'objectives, steps, exercise, key points, or terms'}.")
                    if module["number"] > 1 and (
                        len(topic.get("steps", [])) < 4 or len(topic.get("exercise", [])) < 3
                        or len(topic.get("keyPoints", [])) < 3 or len(topic.get("terms", [])) < 3
                    ):
                        raise SystemExit(f"Module {module_id} topic {topic_id} needs four steps, a three-step exercise, and three key points and terms.")
            for question in module["quiz"]:
                question_id = question.get("id")
                if not question_id or question_id in identifiers:
                    raise SystemExit(f"Missing or duplicate quiz ID: {question_id}")
                identifiers.add(question_id)
                if question.get("topicId") not in topic_ids:
                    raise SystemExit(f"Question {question_id} references an unknown topic.")
                if not 0 <= question.get("answer", -1) < len(question.get("choices", [])):
                    raise SystemExit(f"Invalid answer index for {question_id}.")
                if not question.get("explanation"):
                    raise SystemExit(f"Question {question_id} is missing its explanation.")
                if module["number"] > 1 and len(question.get("choices", [])) != 4:
                    raise SystemExit(f"Question {question_id} must have exactly four answer choices.")
                if module["number"] > 1 and not 0 <= question.get("answer", -1) < 4:
                    raise SystemExit(f"Question {question_id} has an invalid four-choice answer index.")
            if module["number"] > 1:
                for item in module["interviewQuestions"]:
                    if not item.get("question") or not item.get("answer"):
                        raise SystemExit(f"Module {module_id} has an incomplete career interview question.")
                if any(not item.get("term") or not item.get("meaning") for item in module["glossary"]):
                    raise SystemExit(f"Module {module_id} has an incomplete glossary entry.")
    if any(not any(module.get("status") == "available" for module in track["modules"]) for track in tracks):
        raise SystemExit("Each career path must have at least one complete, published module.")
    return identifiers


def main():
    curriculum = json.loads(CURRICULUM_FILE.read_text(encoding="utf-8"))
    career_curricula = json.loads(CAREER_CURRICULA_FILE.read_text(encoding="utf-8"))
    identifiers = validate_curriculum(curriculum)
    validate_career_curricula(career_curricula, identifiers)
    OUTPUT_DIR.mkdir(exist_ok=True)
    available = [(module, OUTPUT_DIR, "SOC Analyst Foundations") for module in curriculum["modules"] if module.get("status") == "available"]
    for track in career_curricula["tracks"]:
        track_output = OUTPUT_DIR / track["id"]
        track_output.mkdir(exist_ok=True)
        available.extend(
            (module, track_output, track["title"])
            for module in track["modules"]
            if module.get("status") == "available"
        )
    if not available:
        raise SystemExit("No modules with authored material are marked available.")
    for module, output_dir, domain_title in available:
        if not module.get("lessons") or not module.get("quiz") or not module.get("pdf"):
            raise SystemExit(f"Module {module['number']} is marked available but content is incomplete.")
        output = output_dir / module["pdf"]
        build_pdf(module, output, domain_title)
        data = output.read_bytes()
        if not data.startswith(b"%PDF-") or b"%%EOF" not in data[-2048:]:
            raise SystemExit(f"Generated file is not a valid PDF: {output}")
        print(f"Generated {output.relative_to(ROOT)} ({len(data):,} bytes)")


if __name__ == "__main__":
    main()
