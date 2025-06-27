import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, MarkdownRenderer } from 'obsidian';
declare const moment: typeof import('moment');
import { getDailyNoteSettings, getAllDailyNotes } from "obsidian-daily-notes-interface";


interface LongtimeDiarySettings {
	mySetting: string;
}


const DEFAULT_SETTINGS: LongtimeDiarySettings = {
	mySetting: 'default'
}


export default class LongtimeDiary extends Plugin {
	settings: LongtimeDiarySettings;

	async onload() {
		await this.loadSettings();
		const DailyNoteSettings = getDailyNoteSettings();
		const DailyNoteFormat = DailyNoteSettings.format;

		this.registerMarkdownCodeBlockProcessor(
			"LongtimeDiary",
			async (source, element, context) => {
				await this.processLongtimeDiaryCodeBlock(source, element, context, this, DailyNoteFormat);
			}
		);

/*		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				// leaf.viewがMarkdownViewかどうかチェック
				if (leaf && leaf.view instanceof MarkdownView && leaf.view.file) {
					const activeFile = leaf.view.file;
					const activeFileName = activeFile.name;
					console.log("active-leaf-change:", activeFileName);
				} else {
					// 何も開いていない場合もある
					console.log("NO active-leaf-change: No active file or not a Markdown view.");
				}
			})
		);*/
	}

	
	async processLongtimeDiaryCodeBlock(
		source: string,
		element: HTMLElement,
		context: any,
		plugin: LongtimeDiary,
		DailyNoteFormat: string | undefined,
	) {
		const activeFile = this.app.vault.getAbstractFileByPath(context.sourcePath) as TFile;
		const container = element.createEl("div", { cls: "LongtimeDiary-block" });

		// 1. デイリーノート判定
		const isDailyNote = activeFile && moment(activeFile.basename, DailyNoteFormat, true).isValid();
		if (!isDailyNote) {
			container.innerText = `This is not a daily note.`;
			return;
		}

		const MMDD = moment(activeFile.basename, DailyNoteFormat).format("MM-DD");
		const foundPaths = new Set<string>();

		// 2. MM-DD一致するDailyNotes抽出
		const MMDD_Dailyfiles = this.getMMDDDailyNotes(MMDD, foundPaths);

		// 3. MM-DD一致する作成日ファイル抽出
		const MMDD_CreatedMMDD_files = this.getMMDDCreatedFiles(MMDD, foundPaths);

		// 4. markdownContent作成
		let markdownContent = `## LongTimeDiary Index\n`;
		markdownContent += `\n### 📅 Daily Notes for ${MMDD}\n\n`;
		markdownContent += this.buildIndexList(MMDD_Dailyfiles, activeFile);

		markdownContent += `\n### ⏲️ Created on ${MMDD}\n\n`;
		if (MMDD_CreatedMMDD_files.length >= 10) {
			markdownContent += "**⚠️ 表示は10件までです。**\n\n";
		}
		markdownContent += this.buildIndexList(MMDD_CreatedMMDD_files);

		markdownContent += `\n\n---\n\n`;
		markdownContent += await this.buildNoteContent(MMDD_Dailyfiles, "📅", activeFile);

		markdownContent += `\n\n---\n\n`;
		markdownContent += await this.buildNoteContent(MMDD_CreatedMMDD_files, "⏲️");

		// 5. レンダリング
		await MarkdownRenderer.render(
			this.app,
			markdownContent,
			container,
			activeFile.path,
			this
		);
	}

/** MM-DD一致するDailyNotesリスト取得 + ソート + foundPathsに追加 */
private getMMDDDailyNotes(MMDD: string, foundPaths: Set<string>): TFile[] {
    const allDailyNotes = getAllDailyNotes();
    const result: TFile[] = [];
    for (const dateUID in allDailyNotes) {
        if (dateUID.slice(9, 14) === MMDD) {
            const file = allDailyNotes[dateUID];
            result.push(file);
            foundPaths.add(file.path);
        }
    }
    result.sort((a, b) => b.name.localeCompare(a.name));
    return result;
}

/** MM-DD一致する作成日ファイルリスト取得 + ソート + foundPathsに追加 */
private getMMDDCreatedFiles(MMDD: string, foundPaths: Set<string>): TFile[] {
    const allFiles = this.app.vault.getFiles();
    const result: TFile[] = [];
    for (const file of allFiles) {
        if (foundPaths.has(file.path)) continue;
        if (file.extension !== "md") continue;
        const CreatedMMDD = moment(file.stat.ctime).format("MM-DD");
        if (CreatedMMDD === MMDD) {
            result.push(file);
            foundPaths.add(file.path);
			if (result.length >= 10) break; // 100件上限
        }
    }
    result.sort((a, b) => b.stat.ctime - a.stat.ctime);
    return result;
}

/** インデックスリスト（箇条書き）の生成 */
private buildIndexList(files: TFile[], activeFile?: TFile): string {
    return files
        .map(f => (activeFile && f.name === activeFile.name)
            ? `- ${f.name}&nbsp;&nbsp;&nbsp;is current file.\n`
            : `- ${f.name}\n`)
        .join('');
}

/** ノート内容を見出し付きでまとめる（非同期） */
private async buildNoteContent(files: TFile[], headerEmoji: string, skipFile?: TFile): Promise<string> {
    let content = "";
    for (const f of files) {
        if (skipFile && f.name === skipFile.name) continue;
        const fileContent = await this.app.vault.read(f);
        content += `\n## ${headerEmoji} ${f.basename}\n${fileContent}\n`;
    }
    return content;
}


	onunload() {

	}


	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}


	async saveSettings() {
		await this.saveData(this.settings);
	}

}
