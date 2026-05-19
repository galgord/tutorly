/**
 * Dev seed for the tutor app.
 *
 * Populates a single tutor (Gal Gordon — Portuguese teacher in Israel)
 * with four students whose L1s vary (Hebrew, Hebrew, Portuguese, English),
 * a handful of past lessons with realistic mixed-language feedback, and
 * a few generated games + completed attempts so the dashboard isn't
 * empty when you sign in.
 *
 * Idempotent: deletes the seed tutor's data and re-creates from scratch
 * on every run, so it's safe to invoke repeatedly.
 *
 * Run with:
 *   pnpm --filter api prisma db seed
 *
 * Requires the dev Postgres to be reachable (default `pnpm docker:up`).
 */

import {
  FeedbackSource,
  GameStatus,
  GameType,
  LessonSource,
  PrismaClient,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

// Stable ids so re-running the seed produces the same UUID-ish strings,
// which keeps shareable URLs stable across re-seeds for the dev session.
const SEED_TUTOR_EMAIL = 'ggordon@luxurypresence.com';

function token(): string {
  return randomBytes(24).toString('base64url');
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// A few canned generated question pools so the games look real on first
// open without burning Anthropic credits.
const VERBS_ER_FILL_BLANK = [
  {
    id: 'q_seed_er_01',
    prompt: 'Eu ___ (comer) feijoada todo domingo.',
    answer: 'como',
    distractors: [],
    acceptAlternates: [],
    topicTags: ['verbos-er', 'presente'],
  },
  {
    id: 'q_seed_er_02',
    prompt: 'Ela sempre ___ (beber) café com leite de manhã.',
    answer: 'bebe',
    distractors: [],
    acceptAlternates: [],
    topicTags: ['verbos-er', 'presente'],
  },
  {
    id: 'q_seed_er_03',
    prompt: 'Nós ___ (correr) no parque aos sábados.',
    answer: 'corremos',
    distractors: [],
    acceptAlternates: [],
    topicTags: ['verbos-er', 'presente', 'nos'],
  },
  {
    id: 'q_seed_er_04',
    prompt: 'Vocês ___ (aprender) português há quanto tempo?',
    answer: 'aprendem',
    distractors: [],
    acceptAlternates: [],
    topicTags: ['verbos-er', 'presente', 'voces'],
  },
  {
    id: 'q_seed_er_05',
    prompt: 'O cachorro ___ (morder) o brinquedo o dia inteiro.',
    answer: 'morde',
    distractors: [],
    acceptAlternates: [],
    topicTags: ['verbos-er', 'presente'],
  },
];

const SER_ESTAR_QUIZ = [
  {
    id: 'q_seed_se_01',
    prompt: 'Maria ___ médica desde 2018.',
    answer: 'é',
    distractors: ['está', 'estava', 'foi'],
    acceptAlternates: [],
    topicTags: ['ser-vs-estar', 'profissao'],
  },
  {
    id: 'q_seed_se_02',
    prompt: 'O café ___ frio. Quer que eu esquente?',
    answer: 'está',
    distractors: ['é', 'foi', 'sendo'],
    acceptAlternates: [],
    topicTags: ['ser-vs-estar', 'estado'],
  },
  {
    id: 'q_seed_se_03',
    prompt: 'Eu ___ brasileiro, nasci em Belo Horizonte.',
    answer: 'sou',
    distractors: ['estou', 'fui', 'tenho'],
    acceptAlternates: [],
    topicTags: ['ser-vs-estar', 'origem'],
  },
  {
    id: 'q_seed_se_04',
    prompt: 'Hoje ___ uma quarta-feira muito chuvosa.',
    answer: 'é',
    distractors: ['está', 'foi', 'sendo'],
    acceptAlternates: [],
    topicTags: ['ser-vs-estar', 'dia-da-semana'],
  },
  {
    id: 'q_seed_se_05',
    prompt: 'Os meninos ___ na praia agora.',
    answer: 'estão',
    distractors: ['são', 'eram', 'foram'],
    acceptAlternates: [],
    topicTags: ['ser-vs-estar', 'localizacao'],
  },
];

const PRETERITE_FILL_BLANK = [
  {
    id: 'q_seed_pr_01',
    prompt: 'Ontem eu ___ (falar) com a minha avó por uma hora.',
    answer: 'falei',
    distractors: [],
    acceptAlternates: [],
    topicTags: ['preterito-perfeito', 'verbos-ar'],
  },
  {
    id: 'q_seed_pr_02',
    prompt: 'Ela ___ (ir) ao mercado e comprou tudo para a feijoada.',
    answer: 'foi',
    distractors: [],
    acceptAlternates: [],
    topicTags: ['preterito-perfeito', 'irregular', 'ir'],
  },
  {
    id: 'q_seed_pr_03',
    prompt: 'Nós ___ (chegar) tarde porque o trânsito estava horrível.',
    answer: 'chegamos',
    distractors: [],
    acceptAlternates: [],
    topicTags: ['preterito-perfeito', 'verbos-ar'],
  },
];

async function main() {
  console.log(`[seed] looking up tutor ${SEED_TUTOR_EMAIL}…`);
  // 1. Tutor — upsert by email so the row id is stable across re-seeds.
  const tutor = await prisma.tutor.upsert({
    where: { email: SEED_TUTOR_EMAIL },
    update: {
      name: 'Gal Gordon',
      locale: 'he',
      subject: 'Portuguese',
      teachingLanguage: 'pt',
      deletedAt: null,
    },
    create: {
      email: SEED_TUTOR_EMAIL,
      name: 'Gal Gordon',
      locale: 'he',
      subject: 'Portuguese',
      teachingLanguage: 'pt',
    },
  });

  // 2. Nuke this tutor's students — cascade removes their lessons,
  //    games, and attempts. Cleanest way to make the seed idempotent.
  const removed = await prisma.student.deleteMany({ where: { tutorId: tutor.id } });
  console.log(`[seed] cleared ${removed.count} existing student(s) for the seed tutor.`);

  // 3. Students with varied L1s.
  type StudentSeed = {
    name: string;
    nativeLanguage: 'he' | 'pt' | 'en';
    notes: string | null;
    lessons: Array<{
      title: string;
      occurredAt: Date;
      feedbackText: string;
      feedbackSource: FeedbackSource;
      games: Array<{
        type: GameType;
        title: string;
        status: GameStatus;
        questionPool: typeof VERBS_ER_FILL_BLANK | typeof SER_ESTAR_QUIZ;
        assignedDaysAgo?: number;
        attempts?: Array<{
          startedDaysAgo: number;
          finishedDaysAgo: number;
          score: number;
          livesLost: number;
          questionResults: unknown;
        }>;
      }>;
    }>;
  };

  const students: StudentSeed[] = [
    {
      name: 'Daniel Cohen',
      nativeLanguage: 'he',
      notes: 'מתחיל, מתקדם מהר. עובד בעיקר על הווה ופעלים -ar/-er.',
      lessons: [
        {
          title: 'פעלים -er בזמן הווה',
          occurredAt: daysAgo(10),
          feedbackText:
            'עבדנו על verbs that end in -er בזמן הווה. דניאל מתבלבל בין הצורה של "nós" לבין הצורה של "vocês" — צריך תרגול נוסף.',
          feedbackSource: FeedbackSource.TEXT,
          games: [
            {
              type: GameType.FILL_BLANK,
              title: 'פעלים -er — נוכחי',
              status: GameStatus.ASSIGNED,
              questionPool: VERBS_ER_FILL_BLANK,
              assignedDaysAgo: 10,
              attempts: [
                {
                  startedDaysAgo: 9,
                  finishedDaysAgo: 9,
                  score: 4,
                  livesLost: 1,
                  questionResults: [
                    { questionId: 'q_seed_er_01', correct: true },
                    { questionId: 'q_seed_er_02', correct: true },
                    { questionId: 'q_seed_er_03', correct: false },
                    { questionId: 'q_seed_er_04', correct: true },
                    { questionId: 'q_seed_er_05', correct: true },
                  ],
                },
                {
                  startedDaysAgo: 4,
                  finishedDaysAgo: 4,
                  score: 5,
                  livesLost: 0,
                  questionResults: [
                    { questionId: 'q_seed_er_01', correct: true },
                    { questionId: 'q_seed_er_02', correct: true },
                    { questionId: 'q_seed_er_03', correct: true },
                    { questionId: 'q_seed_er_04', correct: true },
                    { questionId: 'q_seed_er_05', correct: true },
                  ],
                },
              ],
            },
          ],
        },
        {
          title: 'Ser vs estar',
          occurredAt: daysAgo(3),
          feedbackText:
            'שיעור על ser/estar — דניאל עדיין מתבלבל כשמדובר במצב חולף לעומת תכונה קבועה. הזכרנו שעבודה (profissão) זה ser ולא estar.',
          feedbackSource: FeedbackSource.TEXT,
          games: [
            {
              type: GameType.TIMED_QUIZ,
              title: 'Ser vs estar — חידון מהיר',
              status: GameStatus.ASSIGNED,
              questionPool: SER_ESTAR_QUIZ,
              assignedDaysAgo: 3,
              attempts: [
                {
                  startedDaysAgo: 2,
                  finishedDaysAgo: 2,
                  score: 3,
                  livesLost: 2,
                  questionResults: [
                    { questionId: 'q_seed_se_01', correct: true },
                    { questionId: 'q_seed_se_02', correct: true },
                    { questionId: 'q_seed_se_03', correct: false },
                    { questionId: 'q_seed_se_04', correct: true },
                    { questionId: 'q_seed_se_05', correct: false },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'Maya Levi',
      nativeLanguage: 'he',
      notes: 'תלמידה חדשה. ביישנית בדיבור, מעדיפה תרגול בכתב.',
      lessons: [
        {
          title: 'שיעור היכרות',
          occurredAt: daysAgo(7),
          feedbackText:
            'שיעור ראשון. עברנו על האלפבית, הברכות הבסיסיות (oi, tudo bem), והצגנו את המספרים מ-1 עד 20. מעיין יכולה להמשיך עם תרגול שמיעה.',
          feedbackSource: FeedbackSource.TEXT,
          games: [
            {
              type: GameType.FILL_BLANK,
              title: 'פעלים -er בסיסיים',
              status: GameStatus.DRAFT,
              questionPool: VERBS_ER_FILL_BLANK.slice(0, 3),
            },
          ],
        },
      ],
    },
    {
      name: 'Lucas Almeida',
      nativeLanguage: 'pt',
      notes: 'דובר פורטוגזית מילדות (משפחה ברזילאית). עובד על העשרת אוצר מילים ועל כתיב.',
      lessons: [
        {
          title: 'Pretérito perfeito — verbos irregulares',
          occurredAt: daysAgo(14),
          feedbackText:
            'Trabalhamos com Lucas em verbos irregulares no pretérito perfeito (ir, ser, ter, fazer). Ele se confundia entre "foi" (ir) e "foi" (ser) — boa oportunidade para tirar dúvidas pela escrita.',
          feedbackSource: FeedbackSource.TEXT,
          games: [
            {
              type: GameType.FILL_BLANK,
              title: 'Pretérito perfeito — preencher',
              status: GameStatus.ASSIGNED,
              questionPool: PRETERITE_FILL_BLANK,
              assignedDaysAgo: 14,
              attempts: [
                {
                  startedDaysAgo: 12,
                  finishedDaysAgo: 12,
                  score: 3,
                  livesLost: 0,
                  questionResults: [
                    { questionId: 'q_seed_pr_01', correct: true },
                    { questionId: 'q_seed_pr_02', correct: true },
                    { questionId: 'q_seed_pr_03', correct: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'Sara Johnson',
      nativeLanguage: 'en',
      notes: 'American beginner, lives in Tel Aviv. Picks up vocab fast, struggles with verb conjugation patterns.',
      lessons: [
        {
          title: 'Verbs ending in -er',
          occurredAt: daysAgo(20),
          feedbackText:
            "I worked with Sara on verbs that end in -er — comer, beber, correr. She's solid on the eu/ele forms but mixes up nós (we) and vocês (you-all). Send her a fill-in-blank drill.",
          feedbackSource: FeedbackSource.TEXT,
          games: [
            {
              type: GameType.FILL_BLANK,
              title: '-er verbs drill',
              status: GameStatus.ASSIGNED,
              questionPool: VERBS_ER_FILL_BLANK,
              assignedDaysAgo: 20,
              attempts: [
                {
                  startedDaysAgo: 18,
                  finishedDaysAgo: 18,
                  score: 3,
                  livesLost: 2,
                  questionResults: [
                    { questionId: 'q_seed_er_01', correct: true },
                    { questionId: 'q_seed_er_02', correct: true },
                    { questionId: 'q_seed_er_03', correct: false },
                    { questionId: 'q_seed_er_04', correct: false },
                    { questionId: 'q_seed_er_05', correct: true },
                  ],
                },
                {
                  startedDaysAgo: 6,
                  finishedDaysAgo: 6,
                  score: 4,
                  livesLost: 1,
                  questionResults: [
                    { questionId: 'q_seed_er_01', correct: true },
                    { questionId: 'q_seed_er_02', correct: true },
                    { questionId: 'q_seed_er_03', correct: true },
                    { questionId: 'q_seed_er_04', correct: false },
                    { questionId: 'q_seed_er_05', correct: true },
                  ],
                },
              ],
            },
          ],
        },
        {
          title: 'Ser vs estar',
          occurredAt: daysAgo(5),
          feedbackText:
            "Drilled ser vs estar with Sara. She's getting permanent traits (sou americana) right but trips on temporary states with estar (estou cansada). Practice quiz would help.",
          feedbackSource: FeedbackSource.VOICE,
          games: [
            {
              type: GameType.TIMED_QUIZ,
              title: 'ser vs estar quiz',
              status: GameStatus.DRAFT,
              questionPool: SER_ESTAR_QUIZ,
            },
          ],
        },
      ],
    },
  ];

  for (const sSeed of students) {
    const student = await prisma.student.create({
      data: {
        tutorId: tutor.id,
        name: sSeed.name,
        notes: sSeed.notes,
        nativeLanguage: sSeed.nativeLanguage,
        shareToken: token(),
        shareTokenRotatedAt: new Date(),
      },
    });
    console.log(`[seed]   + student ${student.name} (${sSeed.nativeLanguage})`);

    for (const lSeed of sSeed.lessons) {
      const lesson = await prisma.lesson.create({
        data: {
          studentId: student.id,
          title: lSeed.title,
          source: LessonSource.MANUAL,
          occurredAt: lSeed.occurredAt,
          feedbackText: lSeed.feedbackText,
          feedbackSource: lSeed.feedbackSource,
        },
      });

      for (const gSeed of lSeed.games) {
        const game = await prisma.game.create({
          data: {
            lessonId: lesson.id,
            type: gSeed.type,
            title: gSeed.title,
            status: gSeed.status,
            questionPool: gSeed.questionPool as unknown as object,
            poolSize: gSeed.questionPool.length,
            locale: 'pt',
            assignedAt: gSeed.assignedDaysAgo != null ? daysAgo(gSeed.assignedDaysAgo) : null,
          },
        });

        if (gSeed.attempts) {
          for (const aSeed of gSeed.attempts) {
            await prisma.attempt.create({
              data: {
                gameId: game.id,
                studentId: student.id,
                startedAt: daysAgo(aSeed.startedDaysAgo),
                finishedAt: daysAgo(aSeed.finishedDaysAgo),
                score: aSeed.score,
                livesLost: aSeed.livesLost,
                questionResults: aSeed.questionResults as unknown as object,
              },
            });
          }
        }
      }
    }
  }

  const counts = await prisma.$transaction([
    prisma.student.count({ where: { tutorId: tutor.id } }),
    prisma.lesson.count({ where: { student: { tutorId: tutor.id } } }),
    prisma.game.count({ where: { lesson: { student: { tutorId: tutor.id } } } }),
    prisma.attempt.count({ where: { student: { tutorId: tutor.id } } }),
  ]);
  console.log(
    `[seed] done — ${counts[0]} student(s), ${counts[1]} lesson(s), ${counts[2]} game(s), ${counts[3]} attempt(s).`,
  );
  console.log(`[seed] sign in via magic link to ${SEED_TUTOR_EMAIL} to use the seeded account.`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
