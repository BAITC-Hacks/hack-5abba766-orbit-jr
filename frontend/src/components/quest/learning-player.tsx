"use client";
import { useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, Clock3, GraduationCap, LockKeyhole } from "lucide-react";
import type { CompletionRequest, CompletionResult, EmployeeView, EventView, GoalProgress } from "../../../../contracts/backend";
import type { LessonBlock } from "../../../../contracts/learning";
import { useLearning } from "@/hooks/use-learning";
import { Loading } from "./feedback";

const lessonTitle = (title: string) => title.replace(/^\d+\.\s*/, "");

function Block({ block }: { block: LessonBlock }) {
  if (block.type === "code") return <figure className="learning-code"><figcaption>{block.language}</figcaption><pre><code>{block.code}</code></pre></figure>;
  if (block.type === "bullets") return <ul className="learning-bullets">{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
  return <p className={block.type === "callout" ? "learning-callout" : "learning-paragraph"}>{block.text}</p>;
}

export function LearningPlayer({ employee, moduleId, event, target, names, onClose, onCompleted, onError }: {
  employee: EmployeeView; moduleId: string; event: EventView; target: CompletionRequest["target"];
  names: Record<string, string>; onClose: () => void;
  onCompleted: (result: CompletionResult, previousProgress: GoalProgress | null) => void;
  onError: (error: unknown) => void;
}) {
  const state = useLearning(employee.employee_id, moduleId, target, employee.version, onError);
  const [active, setActive] = useState<number | null>(null);
  const course = state.module;
  const attempt = state.attempt;
  const completed = attempt?.completed_lesson_ids.length ?? 0;
  const index = active ?? Math.min(completed, course?.lesson_count ?? 0);
  const lesson = course?.lessons[index];
  const isQuiz = course && index >= course.lesson_count;
  const passed = attempt?.status === "passed";
  const completion = state.result?.completion ?? attempt?.completion;
  const previousProgress = state.result?.previous_progress ?? attempt?.previous_progress ?? null;
  const returnToProfile = () => {
    if (passed && completion) onCompleted(completion, previousProgress);
    else onClose();
  };
  const move = (next: number) => { setActive(next); document.getElementById("learning-content")?.scrollIntoView({ block: "start", behavior: "smooth" }); };

  return <section className="learning-shell" aria-label="Учебный модуль">
    <div className="learning-topbar">
      <button className="text-button learning-back" onClick={returnToProfile} disabled={state.busy}><ArrowLeft size={16} /> К моему пути</button>
      <span className="learning-demo-label">Учебный демомодуль</span>
    </div>
    {state.loading && <Loading>Открываем материал и сохранённый прогресс…</Loading>}
    {course && <>
      <header className="learning-heading">
        <div><span className="eyebrow">НЕБОЛЬШАЯ ПРАКТИКА. ПОНЯТНЫЙ РЕЗУЛЬТАТ.</span><h1>{course.title}</h1><p>{course.summary}</p></div>
        <div className="learning-heading-icon" aria-hidden="true"><GraduationCap size={44} /></div>
      </header>
      <div className="learning-meta"><span><Clock3 size={15} /> ≈ {course.estimated_minutes} минут</span><span><BookOpen size={15} /> {course.lesson_count} урока</span><span>{course.question_count} вопроса в конце</span></div>
      <p className="learning-context">Короткий практический фрагмент «{event.title}». Полная активность в каталоге — {event.duration_hours} ч. Здесь вы проходите демомодуль и наблюдаете его расчётный эффект на карьерную цель.</p>
    </>}
    {!!state.error && <div className="learning-error" role="alert">
      <strong>{state.needsRefresh ? "Профиль изменился во время обучения" : "Не удалось завершить действие"}</strong>
      <p>{state.error instanceof Error ? state.error.message : "Попробуйте ещё раз."}</p>
      {state.pending ? <><p>Ответ пока не подтверждён. Повторная отправка восстановит результат без повторного начисления навыков.</p><button className="secondary" disabled={state.busy} onClick={() => void state.submitQuiz()}>Восстановить результат</button></>
        : state.needsRefresh ? <><p>Пройденные уроки не потеряются. Выбранные ответы останутся на экране. Обновите данные профиля, чтобы продолжить.</p><button className="secondary" disabled={state.busy} onClick={() => void state.refreshVersion()}>Обновить данные профиля</button></>
          : !attempt && <button className="secondary" disabled={state.loading} onClick={() => void state.initialize()}>Повторить проверку доступа</button>}
    </div>}
    {course && !state.loading && <div className="learning-layout">
      <aside className="learning-sidebar" aria-label="Программа модуля">
        <div className="learning-progress-head"><strong>{passed ? "Модуль пройден" : "Ваш прогресс"}</strong><span>{passed ? "100%" : `${Math.round(completed / (course.lesson_count + 1) * 100)}%`}</span></div>
        <progress className="learning-progress" value={passed ? course.lesson_count + 1 : completed} max={course.lesson_count + 1} aria-label="Прогресс учебного модуля" />
        <ol className="learning-navigation">
          {course.lessons.map((item, i) => {
            const done = attempt?.completed_lesson_ids.includes(item.id);
            const locked = !!attempt && i > completed;
            return <li key={item.id}><button className={`${i === index && !passed ? "active" : ""} ${done ? "done" : ""}`} aria-current={i === index && !passed ? "step" : undefined} disabled={locked || state.busy || state.pending} onClick={() => move(i)}><span className="learning-step-number">{done ? <Check size={16} /> : locked ? <LockKeyhole size={13} /> : i + 1}</span><span>{lessonTitle(item.title)}</span></button></li>;
          })}
          <li><button className={isQuiz && !passed ? "active" : passed ? "done" : ""} disabled={!attempt || completed !== course.lesson_count || state.busy || state.pending} onClick={() => move(course.lesson_count)}><span className="learning-step-number">{passed ? <Check size={16} /> : <GraduationCap size={16} />}</span><span>Проверка понимания</span></button></li>
        </ol>
        <p className="learning-save-note">{attempt ? "Завершённые уроки сохраняются. Можно закрыть модуль и продолжить позже." : "Материал доступен для знакомства. Для учёта прогресса требуется доступ к активности."}</p>
      </aside>
      <div className="learning-reader" id="learning-content">
        {passed ? <section className="learning-celebration" aria-live="polite">
          <div className="learning-success-mark"><CheckCircle2 size={45} /></div>
          <span className="eyebrow">ЕЩЁ ОДИН ШАГ СДЕЛАН</span><h2>Знания проверены.<br />Теперь виден результат.</h2>
          <p>Все ответы верны. Уроки и результат проверки сохранены.</p>
          {completion && <div className="learning-gains">{completion.skill_changes.map(change => <div key={change.skill_id}><span>{names[change.skill_id] ?? "Навык активности"}</span><strong>{change.before} <ArrowRight size={16} /> {change.after}</strong></div>)}</div>}
          {completion?.employee.progress && previousProgress && <p className="learning-coverage">Соответствие цели: <strong>{Math.round(previousProgress.coverage * 100)}% → {Math.round(completion.employee.progress.coverage * 100)}%</strong></p>}
          <button className="primary" onClick={returnToProfile}>Посмотреть мой следующий шаг <ArrowRight size={17} /></button>
          <p className="learning-save-note">Показан результат этого демопрохождения. Актуальный профиль и рекомендации обновятся при возвращении.</p>
        </section> : lesson ? <article className="learning-lesson">
          <span className="eyebrow">УРОК {index + 1} ИЗ {course.lesson_count}</span><h2>{lessonTitle(lesson.title)}</h2>
          {lesson.blocks.map((block, i) => <Block block={block} key={`${lesson.id}:${i}`} />)}
          <div className="learning-lesson-actions">
            {index > 0 && <button className="secondary" disabled={state.busy || state.pending} onClick={() => move(index - 1)}>Назад</button>}
            <button className="primary" disabled={state.busy || state.pending || !attempt} onClick={async () => {
              if (attempt?.completed_lesson_ids.includes(lesson.id) || await state.completeLesson(lesson.id)) move(index + 1);
            }}>{state.busy ? "Сохраняем…" : index === course.lesson_count - 1 ? "Перейти к проверке" : "Изучено, следующий урок"}<ArrowRight size={16} /></button>
          </div>
        </article> : <section className="learning-quiz">
          <span className="eyebrow">ПРИМЕНИТЬ, А НЕ ПРОСТО ПРОЧИТАТЬ</span><h2>Проверим понимание</h2><p>Ответьте на все вопросы. Для завершения нужны все верные ответы; после ошибки можно вернуться к материалу и попробовать снова.</p>
          {state.result && !state.result.completion && <div className="learning-score" role="status">Верно {state.result.feedback.filter(item => item.correct).length} из {course.question_count}. Разберите пояснения и попробуйте ещё раз. Навыки пока не изменились.</div>}
          <form onSubmit={e => { e.preventDefault(); void state.submitQuiz(); }}>
            {course.questions.map((question, q) => {
              const feedback = state.result?.feedback.find(item => item.question_id === question.id);
              return <fieldset key={question.id} disabled={state.busy || state.pending || state.needsRefresh}><legend><span>{q + 1}.</span> {question.prompt}</legend><div className="learning-options">{question.options.map(option => <label key={option.id} className={state.answers[question.id] === option.id ? "selected" : ""}><input type="radio" name={question.id} value={option.id} checked={state.answers[question.id] === option.id} onChange={() => state.answer(question.id, option.id)} required /><span>{option.text}</span></label>)}</div>{feedback && <p className={`learning-answer-feedback ${feedback.correct ? "correct" : "review"}`}><strong>{feedback.correct ? "Верно. " : "Разберём этот момент. "}</strong>{feedback.explanation}</p>}</fieldset>;
            })}
            <div className="learning-lesson-actions"><button type="button" className="secondary" disabled={state.busy || state.pending} onClick={() => move(course.lesson_count - 1)}>К материалу</button><button className="primary" disabled={state.busy || state.pending || state.needsRefresh || !course.questions.every(question => state.answers[question.id])}>{state.busy ? "Проверяем ответы…" : "Проверить ответы"}<CheckCircle2 size={17} /></button></div>
          </form>
        </section>}
        <details className="learning-sources"><summary>Материалы для дальнейшего изучения</summary><ul>{course.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></li>)}</ul></details>
      </div>
    </div>}
  </section>;
}
