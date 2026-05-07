/**
 * AutoPilotSession - Encapsulates Auto Pilot session logic
 *
 * Auto-pilot is an "automatically driven human" - it follows the same message
 * flow as a normal session, but uses yolo mode to skip confirmations.
 */

import type { EnhancedMode } from '../loop';

export interface IssueContext {
    url: string;
    title: string;
    body: string;
    number: number;
    owner: string;
    repo: string;
    /** User's locale for prompt language (e.g., 'en', 'zh-Hans', 'ja') */
    locale?: string;
    /** Maximum retry attempts on failure (default: 3) */
    maxRetries?: number;
    /** Last successful checkpoint commit hash for recovery */
    lastCheckpoint?: string;
}

/**
 * AutoPilot prompt translations keyed by locale.
 * Fallback to English if locale not found.
 */
const autopilotTranslations: Record<string, {
    issueProcessing: string;
    issueInfo: string;
    repository: string;
    issueNumber: string;
    url: string;
    content: string;
    noContent: string;
    steps: string;
    step1: string;
    step2: string;
    step3: string;
    step4: string;
    step5: string;
    startExecution: string;
    checkpointInstruction: string;
    checkpointAnalyze: string;
    checkpointModify: string;
    checkpointPR: string;
    phaseLabel: string;
}> = {
    en: {
        issueProcessing: 'You are Happy Agent, processing GitHub Issue automatically.',
        issueInfo: 'Issue Information:',
        repository: 'Repository',
        issueNumber: 'Issue #',
        url: 'URL',
        content: 'Content',
        noContent: '(no content)',
        steps: 'Please execute the following steps:',
        step1: 'Clone the repository (if not already cloned)',
        step2: 'Analyze this issue to understand what needs to be fixed or added',
        step3: 'Read the relevant code files',
        step4: 'Make necessary modifications',
        step5: 'Create a branch and submit a PR',
        startExecution: 'Start execution.',
        checkpointInstruction: 'After completing each phase, create a checkpoint by committing your changes with a descriptive message. This allows recovery if something goes wrong.',
        checkpointAnalyze: 'Checkpoint: Analysis complete',
        checkpointModify: 'Checkpoint: Modifications complete',
        checkpointPR: 'Checkpoint: PR created successfully',
        phaseLabel: 'Current Phase',
    },
    'zh-Hans': {
        issueProcessing: '你是 Happy Agent，正在自动处理 GitHub Issue。',
        issueInfo: 'Issue 信息：',
        repository: '仓库',
        issueNumber: 'Issue #',
        url: 'URL',
        content: '内容',
        noContent: '(无内容)',
        steps: '请执行以下步骤：',
        step1: '克隆仓库（如尚未克隆）',
        step2: '分析这个 issue，理解需要修复什么或添加什么功能',
        step3: '读取相关代码文件',
        step4: '进行必要的修改',
        step5: '创建分支并提交 PR',
        startExecution: '开始执行。',
        checkpointInstruction: '每个阶段完成后，创建一个检查点（通过 git commit 保存进度）。这使得如果出现问题时可以恢复。',
        checkpointAnalyze: '检查点：分析完成',
        checkpointModify: '检查点：修改完成',
        checkpointPR: '检查点：PR 创建成功',
        phaseLabel: '当前阶段',
    },
    'zh-Hant': {
        issueProcessing: '你是 Happy Agent，正在自動處理 GitHub Issue。',
        issueInfo: 'Issue 信息：',
        repository: '倉庫',
        issueNumber: 'Issue #',
        url: 'URL',
        content: '內容',
        noContent: '(無內容)',
        steps: '請執行以下步驟：',
        step1: '克隆倉庫（如尚未克隆）',
        step2: '分析這個 issue，理解需要修復什麼或添加什麼功能',
        step3: '讀取相關代碼文件',
        step4: '進行必要的修改',
        step5: '創建分支並提交 PR',
        startExecution: '開始執行。',
        checkpointInstruction: '每個階段完成後，創建一個檢查點（通過 git commit 保存進度）。這使得如果出現問題時可以恢復。',
        checkpointAnalyze: '檢查點：分析完成',
        checkpointModify: '檢查點：修改完成',
        checkpointPR: '檢查點：PR 創建成功',
        phaseLabel: '當前階段',
    },
    ja: {
        issueProcessing: 'あなたは Happy Agent で、GitHub Issue を自動処理しています。',
        issueInfo: 'Issue 情報：',
        repository: 'リポジトリ',
        issueNumber: 'Issue #',
        url: 'URL',
        content: '内容',
        noContent: '(内容なし)',
        steps: '以下のステップを実行してください：',
        step1: 'リポジトリをクローン（まだの場合）',
        step2: 'この issue を分析し、修正または追加が必要なものを理解する',
        step3: '関連するコードファイルを読む',
        step4: '必要な変更を加える',
        step5: 'ブランチを作成して PR を提出する',
        startExecution: '実行を開始します。',
        checkpointInstruction: '各フェーズの完了後、チャックポイントを作成してください（git commit で進捗を保存）。これにより、問題が発生した場合に回復できます。',
        checkpointAnalyze: 'チェックポイント：分析完了',
        checkpointModify: 'チェックポイント：修正完了',
        checkpointPR: 'チェックポイント：PR作成成功',
        phaseLabel: '現在のフェーズ',
    },
    es: {
        issueProcessing: 'Eres Happy Agent, procesando GitHub Issue automáticamente.',
        issueInfo: 'Información del Issue:',
        repository: 'Repositorio',
        issueNumber: 'Issue #',
        url: 'URL',
        content: 'Contenido',
        noContent: '(sin contenido)',
        steps: 'Por favor ejecute los siguientes pasos:',
        step1: 'Clonar el repositorio (si aún no está clonado)',
        step2: 'Analizar este issue para entender qué necesita ser corregido o añadido',
        step3: 'Leer los archivos de código relevantes',
        step4: 'Hacer las modificaciones necesarias',
        step5: 'Crear una rama y enviar un PR',
        startExecution: 'Comenzar ejecución.',
        checkpointInstruction: 'Después de completar cada fase, crea un punto de control confirmando tus cambios con un mensaje descriptivo. Esto permite la recuperación si algo sale mal.',
        checkpointAnalyze: 'Punto de control: Análisis completo',
        checkpointModify: 'Punto de control: Modificaciones completas',
        checkpointPR: 'Punto de control: PR creado exitosamente',
        phaseLabel: 'Fase actual',
    },
    ca: {
        issueProcessing: 'Ets Happy Agent, processant GitHub Issue automàticament.',
        issueInfo: 'Informació del Issue:',
        repository: 'Repositori',
        issueNumber: 'Issue #',
        url: 'URL',
        content: 'Contingut',
        noContent: '(sense contingut)',
        steps: 'Si us plau, executeu els passos següents:',
        step1: 'Clonar el repositori (si encara no està clonat)',
        step2: 'Analitzar aquest issue per entendre què cal corregir o afegir',
        step3: 'Llegir els fitxers de codi rellevants',
        step4: 'Fer les modificacions necessàries',
        step5: 'Crear una branca i enviar un PR',
        startExecution: 'Començar execució.',
        checkpointInstruction: 'Després de completar cada fase, creeu un punt de control confirmant els vostres canvis amb un missatge descriptiu. Això permet la recuperació si alguna cosa surt malament.',
        checkpointAnalyze: 'Punt de control: Anàlisi completa',
        checkpointModify: 'Punt de control: Modificacions completes',
        checkpointPR: 'Punt de control: PR creat amb èxit',
        phaseLabel: 'Fase actual',
    },
    it: {
        issueProcessing: 'Sei Happy Agent, elaborando GitHub Issue automaticamente.',
        issueInfo: 'Informazioni Issue:',
        repository: 'Repository',
        issueNumber: 'Issue #',
        url: 'URL',
        content: 'Contenuto',
        noContent: '(nessun contenuto)',
        steps: 'Si prega di eseguire i seguenti passaggi:',
        step1: 'Clonare il repository (se non già clonato)',
        step2: 'Analizzare questo issue per capire cosa deve essere corretto o aggiunto',
        step3: 'Leggere i file di codice rilevanti',
        step4: 'Apportare le modifiche necessarie',
        step5: 'Creare un branch e inviare un PR',
        startExecution: 'Inizia esecuzione.',
        checkpointInstruction: 'Dopo aver completato ogni fase, crea un checkpoint confermando le tue modifiche con un messaggio descrittivo. Questo consente il recupero se qualcosa va storto.',
        checkpointAnalyze: 'Checkpoint: Analisi completata',
        checkpointModify: 'Checkpoint: Modifiche completate',
        checkpointPR: 'Checkpoint: PR creato con successo',
        phaseLabel: 'Fase attuale',
    },
    pt: {
        issueProcessing: 'Você é Happy Agent, processando GitHub Issue automaticamente.',
        issueInfo: 'Informações do Issue:',
        repository: 'Repositório',
        issueNumber: 'Issue #',
        url: 'URL',
        content: 'Conteúdo',
        noContent: '(sem conteúdo)',
        steps: 'Por favor, execute os seguintes passos:',
        step1: 'Clonar o repositório (se ainda não clonado)',
        step2: 'Analisar este issue para entender o que precisa ser corrigido ou adicionado',
        step3: 'Ler os arquivos de código relevantes',
        step4: 'Fazer as modificações necessárias',
        step5: 'Criar um branch e submeter um PR',
        startExecution: 'Iniciar execução.',
        checkpointInstruction: 'Após completar cada fase, crie um checkpoint confirmando suas alterações com uma mensagem descritiva. Isso permite recuperação se algo der errado.',
        checkpointAnalyze: 'Checkpoint: Análise completa',
        checkpointModify: 'Checkpoint: Modificações completas',
        checkpointPR: 'Checkpoint: PR criado com sucesso',
        phaseLabel: 'Fase atual',
    },
    pl: {
        issueProcessing: 'Jesteś Happy Agent, przetwarzasz GitHub Issue automatycznie.',
        issueInfo: 'Informacje o Issue:',
        repository: 'Repozytorium',
        issueNumber: 'Issue #',
        url: 'URL',
        content: 'Treść',
        noContent: '(brak treści)',
        steps: 'Wykonaj następujące kroki:',
        step1: 'Sklonuj repozytorium (jeśli jeszcze nie sklonowane)',
        step2: 'Przeanalizuj ten issue, aby zrozumieć, co należy naprawić lub dodać',
        step3: 'Przeczytaj odpowiednie pliki kodu',
        step4: 'Wprowadź niezbędne modyfikacje',
        step5: 'Utwórz branch i wyślij PR',
        startExecution: 'Rozpocznij wykonanie.',
        checkpointInstruction: 'Po zakończeniu każdej fazy utwórz punkt kontrolny, zatwierdzając zmiany opisowym commitem. Umożliwia to przywrócenie, jeśli coś pójdzie nie tak.',
        checkpointAnalyze: 'Punkt kontrolny: Analiza zakończona',
        checkpointModify: 'Punkt kontrolny: Modyfikacje zakończone',
        checkpointPR: 'Punkt kontrolny: PR utworzony pomyślnie',
        phaseLabel: 'Bieżąca faza',
    },
    ru: {
        issueProcessing: 'Вы — Happy Agent, автоматически обрабатываете GitHub Issue.',
        issueInfo: 'Информация о Issue:',
        repository: 'Репозиторий',
        issueNumber: 'Issue #',
        url: 'URL',
        content: 'Содержание',
        noContent: '(без содержания)',
        steps: 'Пожалуйста, выполните следующие шаги:',
        step1: 'Клонировать репозиторий (если ещё не клонирован)',
        step2: 'Проанализировать этот issue, чтобы понять, что нужно исправить или добавить',
        step3: 'Прочитать соответствующие файлы кода',
        step4: 'Внести необходимые изменения',
        step5: 'Создать ветку и отправить PR',
        startExecution: 'Начать выполнение.',
        checkpointInstruction: 'После завершения каждого этапа создайте контрольную точку, зафиксировав изменения описательным коммитом. Это позволяет восстановиться, если что-то пойдёт не так.',
        checkpointAnalyze: 'Контрольная точка: Анализ завершён',
        checkpointModify: 'Контрольная точка: Изменения завершены',
        checkpointPR: 'Контрольная точка: PR успешно создан',
        phaseLabel: 'Текущий этап',
    },
};

function getTranslations(locale?: string): typeof autopilotTranslations['en'] {
    if (!locale) {
        return autopilotTranslations['en'];
    }
    // Try exact match first
    if (autopilotTranslations[locale]) {
        return autopilotTranslations[locale];
    }
    // Try language-only match (e.g., 'zh' -> 'zh-Hans')
    const lang = locale.split('-')[0];
    for (const key of Object.keys(autopilotTranslations)) {
        if (key.startsWith(lang)) {
            return autopilotTranslations[key];
        }
    }
    return autopilotTranslations['en'];
}

export class AutoPilotSession {
    constructor(private issueContext: IssueContext) {}

    /**
     * Generate the prompt sent to AI for processing the issue.
     * Uses user's locale if available, falls back to English.
     * Includes checkpoint instructions for phase-based progress tracking.
     */
    generatePrompt(): string {
        const { url, title, body, number, owner, repo, locale } = this.issueContext;
        const t = getTranslations(locale);

        return `${t.issueProcessing}

${t.issueInfo}
- ${t.repository}: ${owner}/${repo}
- ${t.issueNumber}${number}: ${title}
- ${t.url}: ${url}
- ${t.content}: ${body || t.noContent}

${t.steps}
1. ${t.step1}
2. ${t.step2} - ${t.checkpointAnalyze}
3. ${t.step3}
4. ${t.step4} - ${t.checkpointModify}
5. ${t.step5} - ${t.checkpointPR}

${t.checkpointInstruction}

${t.startExecution}`;
    }

    /**
     * Get the mode configuration for Auto Pilot
     * Uses 'yolo' mode for full autonomy (auto-approve all tool calls)
     */
    getModeConfig(currentMode: Omit<EnhancedMode, 'permissionMode'>): EnhancedMode {
        return {
            permissionMode: 'yolo',
            model: currentMode.model,
            reasoningEffort: currentMode.reasoningEffort,
            fallbackModel: currentMode.fallbackModel,
            customSystemPrompt: currentMode.customSystemPrompt,
            appendSystemPrompt: currentMode.appendSystemPrompt,
            allowedTools: currentMode.allowedTools,
            disallowedTools: currentMode.disallowedTools,
        };
    }

    /**
     * Generate a recovery prompt for resuming from a checkpoint after failure.
     * Includes the last checkpoint commit hash to restore state.
     */
    getRecoveryPrompt(lastCheckpointCommit: string): string {
        const { url, title, body, number, owner, repo, locale } = this.issueContext;
        const t = getTranslations(locale);

        return `${t.issueProcessing}

${t.issueInfo}
- ${t.repository}: ${owner}/${repo}
- ${t.issueNumber}${number}: ${title}
- ${t.url}: ${url}
- ${t.content}: ${body || t.noContent}

RECOVERY MODE: Previous session failed. Restoring from checkpoint: ${lastCheckpointCommit}

${t.steps}
1. ${t.step1}
2. ${t.step2} - ${t.checkpointAnalyze}
3. ${t.step3}
4. ${t.step4} - ${t.checkpointModify}
5. ${t.step5} - ${t.checkpointPR}

${t.checkpointInstruction}

${t.startExecution}`;
    }

    /**
     * Get the retry count limit for this AutoPilot session.
     */
    getMaxRetries(): number {
        return this.issueContext.maxRetries ?? 3;
    }

    /**
     * Create IssueContext from environment variables
     * Used when spawning via daemon with autoPilotIssue option
     */
    static fromEnvironment(): IssueContext | null {
        const url = process.env.GITHUB_ISSUE_URL;
        const number = process.env.GITHUB_ISSUE_NUMBER;

        if (!url || !number) {
            return null;
        }

        return {
            url,
            title: process.env.GITHUB_ISSUE_TITLE || '',
            body: process.env.GITHUB_ISSUE_BODY || '',
            number: parseInt(number, 10),
            owner: process.env.GITHUB_ISSUE_OWNER || '',
            repo: process.env.GITHUB_ISSUE_REPO || '',
            locale: process.env.HAPPY_AUTO_PILOT_LOCALE,
            maxRetries: process.env.HAPPY_AUTO_PILOT_MAX_RETRIES
                ? parseInt(process.env.HAPPY_AUTO_PILOT_MAX_RETRIES, 10)
                : undefined,
            lastCheckpoint: process.env.HAPPY_AUTO_PILOT_LAST_CHECKPOINT || undefined,
        };
    }
}
