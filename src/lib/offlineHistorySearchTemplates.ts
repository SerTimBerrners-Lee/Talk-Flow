export type OfflineHistoryConceptId =
  | "issue"
  | "task"
  | "decision"
  | "idea"
  | "commitment"
  | "risk";

export interface OfflineHistoryConcept {
  id: OfflineHistoryConceptId;
  queryPatterns: RegExp[];
  recordPatterns: RegExp[];
  controlTokenPatterns: RegExp[];
  embeddingHint: string;
}

const CYRILLIC_PREFIX = "(?:^|[^а-яё])";
const CYRILLIC_SUFFIX = "(?=$|[^а-яё])";

function cyrillicWord(stems: string): RegExp {
  return new RegExp(`${CYRILLIC_PREFIX}(?:${stems})[а-яё]*${CYRILLIC_SUFFIX}`, "i");
}

const OFFLINE_HISTORY_CONCEPTS: OfflineHistoryConcept[] = [
  {
    id: "issue",
    queryPatterns: [
      cyrillicWord("баг|ошиб|проблем|дефект|неисправ|жалоб|жалов"),
      /(?:не\s+работал[а-я]*|перестал[а-я]*\s+работать|некорректн[а-я]*\s+поведен[а-я]*)/i,
      /\b(?:bug(?:s|gy)?|error(?:s)?|issue(?:s)?|problem(?:s)?|broken)\b/i,
    ],
    recordPatterns: [
      cyrillicWord("баг|ошиб|проблем|дефект|неисправ|жалоб|жалов"),
      /не\s+устраивает/i,
      /не\s+(?:работает|работают|срабатывает|срабатывают|отображается|отображаются|сохраняется|сохраняются|запускается|запускаются|переводит|появляется|появляются)/i,
      /перестал[а-яё]*\s+(?:работать|срабатывать|отображаться|сохраняться|запускаться|переводить|появляться)/i,
      /(?:сломал[а-яё]*|зависает|зависают|подвисает|подвисают|тупит|тормозит|прыгает|прыгают|обрезается|обрезаются|пропадает|пропадают)/i,
      /не\s+да[её]т/i,
      /\b(?:bug(?:s|gy)?|error(?:s)?|issue(?:s)?|problem(?:s)?|broken|freezes?|hangs?|fails?)\b/i,
      /\b(?:does\s+not|doesn't|is\s+not|isn't|stopped)\s+(?:work(?:ing)?|trigger(?:ing)?|show(?:ing)?|save|saving|start(?:ing)?|appear(?:ing)?)\b/i,
    ],
    controlTokenPatterns: [
      /^(?:баг|баги|багов|ошибка|ошибки|ошибок|проблема|проблемы|проблем|дефект|дефекты|жалоб[а-яё]*|жалов[а-яё]*)$/i,
      /^(?:bug|bugs|error|errors|issue|issues|problem|problems)$/i,
    ],
    embeddingHint: "Описание багов, ошибок, неисправностей и некорректного поведения: не работает, зависает, пропадает, сломано или мешает пользоваться.",
  },
  {
    id: "task",
    queryPatterns: [
      cyrillicWord("задач|поруч"),
      /что\s+(?:нужно|надо|требуется)\s+сделать/i,
      /\b(?:task(?:s)?|todo|to-do|action\s+items?)\b/i,
    ],
    recordPatterns: [
      cyrillicWord("задач|поруч"),
      /(?:нужно|надо|требуется|необходимо)\s+(?:будет\s+)?(?:сделать|добавить|исправить|проверить|подготовить|отправить|обновить|реализовать)/i,
      /(?:должен|должна|должны)\s+(?:сделать|добавить|исправить|проверить|подготовить|отправить|обновить|реализовать)/i,
      /\b(?:task(?:s)?|todo|to-do|action\s+items?)\b/i,
      /\b(?:need|needs|must|should)\s+to\s+(?:do|add|fix|check|prepare|send|update|implement)\b/i,
    ],
    controlTokenPatterns: [
      /^(?:задач[а-яё]*|поруч[а-яё]*)$/i,
      /^(?:task|tasks|todo|action|items)$/i,
    ],
    embeddingHint: "Задачи, поручения и следующие действия: что нужно сделать, проверить, исправить, подготовить или реализовать.",
  },
  {
    id: "decision",
    queryPatterns: [
      cyrillicWord("решен|договоренност|договорил|утвердил|согласовал"),
      /что\s+(?:мы\s+)?решили/i,
      /\b(?:decision(?:s)?|decided|agreed|agreement(?:s)?|approved)\b/i,
    ],
    recordPatterns: [
      cyrillicWord("решен|договоренност"),
      /(?:решили|договорились|утвердили|согласовали|приняли\s+решение|пришли\s+к\s+выводу)/i,
      /\b(?:decision(?:s)?|decided|agreed|agreement(?:s)?|approved)\b/i,
    ],
    controlTokenPatterns: [
      /^(?:решен[а-яё]*|решили|договоренност[а-яё]*|договорились|утвердили|согласовали)$/i,
      /^(?:decision|decisions|decided|agreed|agreement|agreements|approved)$/i,
    ],
    embeddingHint: "Принятые решения и договорённости: что решили, согласовали, утвердили или зафиксировали.",
  },
  {
    id: "idea",
    queryPatterns: [
      /(?:^|[^а-яё])иде(?:я|и|ю|й|ей|ями|ях)(?=$|[^а-яё])/i,
      cyrillicWord("предложен|вариант"),
      /что\s+(?:я|мы)\s+предлагал[а-я]*/i,
      /\b(?:idea(?:s)?|suggestion(?:s)?|proposal(?:s)?|proposed)\b/i,
    ],
    recordPatterns: [
      /(?:^|[^а-яё])иде(?:я|и|ю|й|ей|ями|ях)(?=$|[^а-яё])/i,
      cyrillicWord("предложен|вариант"),
      /(?:предлагаю|предложил[а-я]*|можно\s+было\s+бы|как\s+вариант|есть\s+идея)/i,
      /\b(?:idea(?:s)?|suggestion(?:s)?|proposal(?:s)?|proposed|could\s+try)\b/i,
    ],
    controlTokenPatterns: [
      /^(?:иде[а-яё]*|предложен[а-яё]*|предлагал[а-яё]*|вариант[а-яё]*)$/i,
      /^(?:idea|ideas|suggestion|suggestions|proposal|proposals|proposed)$/i,
    ],
    embeddingHint: "Идеи, предложения и варианты реализации: что предлагали попробовать, изменить или добавить.",
  },
  {
    id: "commitment",
    queryPatterns: [
      cyrillicWord("обещ|обязательств"),
      /(?:кто|что)(?:\s+(?:я|мы|он|она|они))?\s+(?:обещал[а-яё]*|обязался|обязалась)/i,
      /\b(?:promise(?:s|d)?|commitment(?:s)?|committed)\b/i,
    ],
    recordPatterns: [
      cyrillicWord("обещ|обязательств"),
      /(?:обещал[а-яё]*|обязал[а-яё]*|беру\s+на\s+себя|возьму\s+на\s+себя|я\s+сделаю|мы\s+сделаем)/i,
      /\b(?:promise(?:s|d)?|commitment(?:s)?|committed|i(?:'ll|\s+will)|we(?:'ll|\s+will))\b/i,
    ],
    controlTokenPatterns: [
      /^(?:обещ[а-яё]*|обязательств[а-яё]*|обязал[а-яё]*)$/i,
      /^(?:promise|promises|promised|commitment|commitments|committed)$/i,
    ],
    embeddingHint: "Обещания и обязательства участников: кто взял ответственность и что пообещал сделать.",
  },
  {
    id: "risk",
    queryPatterns: [
      cyrillicWord("риск|блокер|опас|угроз|препятств"),
      /что\s+может\s+(?:помешать|сорваться|сломаться)/i,
      /\b(?:risk(?:s)?|blocker(?:s)?|threat(?:s)?|concern(?:s)?)\b/i,
    ],
    recordPatterns: [
      cyrillicWord("риск|блокер|опас|угроз|препятств"),
      /(?:может|могут)\s+(?:помешать|сорваться|сломаться|задержать|заблокировать)/i,
      /\b(?:risk(?:s)?|blocker(?:s)?|threat(?:s)?|concern(?:s)?|may\s+block)\b/i,
    ],
    controlTokenPatterns: [
      /^(?:риск[а-яё]*|блокер[а-яё]*|опас[а-яё]*|угроз[а-яё]*|препятств[а-яё]*)$/i,
      /^(?:risk|risks|blocker|blockers|threat|threats|concern|concerns)$/i,
    ],
    embeddingHint: "Риски, блокеры и препятствия: что может помешать, задержать или привести к сбою.",
  },
];

const COMMON_CONTROL_TOKEN_PATTERNS = [
  /^(?:описал[а-яё]*|описывал[а-яё]*|запис[а-яё]*|котор[а-яё]*)$/i,
  /^(?:record|records|recording|recordings)$/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function matchOfflineHistoryConcepts(question: string): OfflineHistoryConcept[] {
  return OFFLINE_HISTORY_CONCEPTS.filter((concept) =>
    matchesAny(question, concept.queryPatterns),
  );
}

export function isOfflineConceptHistoryQuestion(question: string): boolean {
  if (matchOfflineHistoryConcepts(question).length === 0) return false;

  return /(?:найди|найти|покажи|отыщи|перечисли|где|в\s+каких\s+запис|из\s+истории|раньше|ранее|что\s+(?:я|мы|он|она|они)\s+(?:решил|решали|обещал|предлагал|обсуждал)|какие\s+.+\s+(?:я|мы|он|она|они)\s+(?:принимал|ставил|фиксировал|обсуждал)|find|show|list|where|what\s+(?:did|were|was))/i.test(question);
}

export function filterOfflineHistoryQueryTokens(
  tokens: string[],
  concepts: OfflineHistoryConcept[],
): string[] {
  if (concepts.length === 0) return tokens;

  return tokens.filter((token) =>
    !matchesAny(
      token,
      [
        ...COMMON_CONTROL_TOKEN_PATTERNS,
        ...concepts.flatMap((concept) => concept.controlTokenPatterns),
      ],
    ),
  );
}

export function scoreOfflineHistoryConcepts(
  text: string,
  concepts: OfflineHistoryConcept[],
): number {
  return concepts.reduce(
    (total, concept) =>
      total + concept.recordPatterns.reduce(
        (score, pattern) => score + (pattern.test(text) ? 8 : 0),
        0,
      ),
    0,
  );
}

export function firstOfflineHistoryConceptMatchIndex(
  text: string,
  concepts: OfflineHistoryConcept[],
): number {
  return concepts.reduce((best, concept) => {
    const conceptIndex = concept.recordPatterns.reduce((current, pattern) => {
      const index = text.search(pattern);
      if (index < 0) return current;
      return current < 0 ? index : Math.min(current, index);
    }, -1);
    if (conceptIndex < 0) return best;
    return best < 0 ? conceptIndex : Math.min(best, conceptIndex);
  }, -1);
}

export function buildOfflineHistoryEmbeddingQuery(question: string): string {
  const concepts = matchOfflineHistoryConcepts(question);
  if (concepts.length === 0) return question;

  return [question, ...concepts.map((concept) => concept.embeddingHint)].join("\n");
}
