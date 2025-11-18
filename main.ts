import {
	MarkdownView, MarkdownRenderer, MarkdownRenderChild, MarkdownPostProcessorContext,
	Plugin,
/*	PluginSettingTab, Setting, */
	TFile,
	moment,
} from 'obsidian';
import { getDailyNoteSettings, getAllDailyNotes } from "obsidian-daily-notes-interface";


interface LongtimeDiarySettings {
	createdFilesLimit: number;
}


const DEFAULT_SETTINGS: LongtimeDiarySettings = {
	createdFilesLimit: 10,
}


export default class LongtimeDiary extends Plugin {
	settings: LongtimeDiarySettings;
	static renderdFileRecord: Record<string, string[]> = {};
	accentColor: string

	async onload() {
		await this.loadSettings();
/*		this.addSettingTab(new LongtimeDiarySettingTab(this.app, this));
*/
		const DailyNoteSettings = getDailyNoteSettings();
		const DailyNoteFormat = DailyNoteSettings.format;
/*		this.accentColor = getComputedStyle(document.body).getPropertyValue('--text-accent').trim() || "#49a";
*/
		this.registerMarkdownCodeBlockProcessor(
			"LongtimeDiary",
			async (source: string, element: HTMLElement, context: MarkdownPostProcessorContext) => {
				await this.processLongtimeDiaryCodeBlock(source, element, context, DailyNoteFormat);
			}
		);

	}

	
	async processLongtimeDiaryCodeBlock(
		source: string,
		element: HTMLElement,
		context: MarkdownPostProcessorContext,
		DailyNoteFormat: string | undefined,
	) {
		const abstractFile = this.app.vault.getAbstractFileByPath(context.sourcePath);
		if (!(abstractFile instanceof TFile)) {
			const container = element.createEl("div", { cls: "LongtimeDiary-block" });
			container.innerText = `This file is not a file.\nThe Longtime diary block must be described in a Daily note file.`;
			return;
		}
		const activeFile = abstractFile;
		
		const container = element.createEl("div", { cls: "LongtimeDiary-block" });
		
		// 1. デイリーノート判定
		const isDailyNote = activeFile && moment(activeFile.basename, DailyNoteFormat, true).isValid();
		if (!isDailyNote) {
			container.innerText = `This file is not a Daily Note.\nThe Longtime diary block must be described in a Daily note.`;
			return;
		}

		const MMDD = moment(activeFile.basename, DailyNoteFormat).format("MM-DD");
		const foundPaths = new Set<string>();

		// 2. MM-DD一致するDailyNotes抽出
		const MMDD_Dailyfiles = this.getMMDDDailyNotes(MMDD, foundPaths);

		// 3. MM-DD一致する作成日ファイル抽出
//		const allCreatedFiles = this.getMMDDCreatedFiles(MMDD, foundPaths);
		
//		const limit = this.settings.createdFilesLimit;
//		const hasMore = allCreatedFiles.length > limit;
//		const MMDD_CreatedMMDD_files = hasMore ? allCreatedFiles.slice(0, limit) : allCreatedFiles;
		
		// `foundPaths` に追加 (getMMDDCreatedFiles内ではやらなくなったため)
		// MMDD_CreatedMMDD_files.forEach(file => foundPaths.add(file.path));


		// 4. markdownContent作成
		let markdownContent = '';

		// ▼ 折りたたみヘッダー
		markdownContent += `<div class="ltd-toggle-header">▼ Longtime diary</div>\n`;

		// ▼ 折りたたみ対象コンテンツ
		markdownContent += `<div class="ltd-toggle-content">\n`;

		markdownContent += `\n#### 📅 Daily Notes on ${MMDD}\n\n`;
		markdownContent += this.buildIndexList(MMDD_Dailyfiles, activeFile);

/*		markdownContent += `\n#### ⏲️ Created at ${MMDD}\n\n`;
		if (hasMore) {
			markdownContent += `**⚠️ Display is limited to ${limit} items.**\n\n`;
		}
		markdownContent += this.buildIndexList(MMDD_CreatedMMDD_files);
*/

		// Note contents
		markdownContent += `\n\n---\n\n`;
		markdownContent += await this.buildNoteContent(MMDD_Dailyfiles, "📅", activeFile);

/*		markdownContent += `\n\n---\n\n`;
		markdownContent += await this.buildNoteContent(MMDD_CreatedMMDD_files, "⏲️", activeFile);
*/
		markdownContent += `</div>\n`;  // ← 折りたたみ対象コンテンツ終わり


		// 5. レンダリング
		const tempComponent = new MarkdownRenderChild(container);
		context.addChild(tempComponent);

		await MarkdownRenderer.render(
			this.app,
			markdownContent,
			container,
			activeFile.path,
			tempComponent
		);

		// 折りたたみ動作の設定
		const toggleHeader = container.querySelector('.ltd-toggle-header') as HTMLElement;
		const toggleContent = container.querySelector('.ltd-toggle-content') as HTMLElement;
		if (toggleHeader && toggleContent) {
			let isCollapsed = false;
			toggleHeader.addEventListener('click', () => {
				isCollapsed = !isCollapsed;
				toggleContent.classList.toggle('is-collapsed', isCollapsed);
				toggleHeader.innerText = isCollapsed ? '▶ Longtime diary' : '▼ Longtime diary';
			});
			// 初期表示状態
			toggleHeader.innerText = '▼ Longtime diary';
		}

		// 6. アンカーリンクのクリックイベントを設定
		container.querySelectorAll('a[data-target-id]').forEach(anchor => {
			anchor.addEventListener('click', (event) => {
				event.preventDefault(); // デフォルトのリンク動作をキャンセル
				const targetId = (anchor as HTMLElement).dataset.targetId;
				if (targetId) {
					const targetElement = container.querySelector(`#${targetId}`);
					if (targetElement) {
						const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (activeMarkdownView && activeMarkdownView.contentEl) {
							let scrollContainer: HTMLElement = activeMarkdownView.contentEl;

							// 実際のスクロールコンテナを特定する試み
							// activeMarkdownView.contentEl の子要素でスクロール可能なものがあればそれを優先
							// または、targetElement から親を辿ってスクロール可能な要素を探す
							let currentElement: HTMLElement | null = targetElement as HTMLElement | null;
							while (currentElement && currentElement !== activeMarkdownView.contentEl.parentElement) {
								// スクロールバーがあるかどうかを簡易的に判定
								if (currentElement.scrollHeight > currentElement.clientHeight) {
									scrollContainer = currentElement;
									break;
								}
								currentElement = currentElement.parentElement;
							}

							// スクロール可能なコンテナに対するターゲット要素の相対位置を計算
							const targetRect = targetElement.getBoundingClientRect();
							const scrollContainerRect = scrollContainer.getBoundingClientRect();

							// スクロール位置を計算: ターゲットの上端がスクロールコンテナの上端に来るように
							const scrollY = targetRect.top - scrollContainerRect.top + scrollContainer.scrollTop;

							// スクロールを実行
							scrollContainer.scrollTo({
								top: scrollY,
								behavior: 'smooth'
							});
						} else {
							// フォールバックとして、通常のscrollIntoViewをわずかに遅延させて実行
							setTimeout(() => {
								targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
							}, 50);
						}
					}
				}
			});
		});

		// ノートを新規タブ（ペイン）で開くリンクにイベントリスナーを設定
		container.querySelectorAll('a[data-file-path]').forEach(link => {
			link.addEventListener('click', (e) => {
				e.preventDefault();
				void (async () => {
					const filePath = (link as HTMLElement).getAttribute('data-file-path');
					if (!filePath) return;
					const file = this.app.vault.getAbstractFileByPath(filePath);
					if (!(file instanceof TFile)) return;
					const leaf = this.app.workspace.getLeaf(false);
					await leaf.openFile(file, { active: false });
				})();
			});
		});

		// 7. レンダリング後のクリーンアップ処理
//		const child = new MarkdownRenderChild(container);
//		context.addChild(child);
//		child.onunload = () => {
//			// このブロックが破棄されるタイミングでクリーンアップ処理を実行
//			delete LongtimeDiary.renderdFileRecord[activeFile.path];
//		};
		tempComponent.onunload = () => {
			delete LongtimeDiary.renderdFileRecord[activeFile.path];
		};

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

	/** MM-DD一致する作成日ファイルリスト取得 + ソート */
	private getMMDDCreatedFiles(MMDD: string, foundPaths: Set<string>): TFile[] {
		const allFiles = this.app.vault.getFiles();
		const result: TFile[] = [];
		for (const file of allFiles) {
			if (foundPaths.has(file.path)) continue;
			if (file.extension !== "md") continue;
			const CreatedMMDD = moment(file.stat.ctime).format("MM-DD");
			if (CreatedMMDD === MMDD) {
				result.push(file);
			}
		}
		result.sort((a, b) => b.stat.ctime - a.stat.ctime);
		return result;
	}

	/** インデックスリスト（箇条書き）の生成 */
	private buildIndexList(files: TFile[], activeFile?: TFile): string {
		return files
			.map(f => {
				if (activeFile && f.path === activeFile.path) {
					return `- ${f.name}&nbsp;&nbsp;&nbsp;is current file.\n`;
				} else {
					const anchorId = this.generateAnchorId(f);
					return `- <a href="#" data-target-id="${anchorId}">${f.name}</a>\n`;
				}
			})
			.join('');
	}

	/** ノート内容を見出し付きでまとめる（非同期） */
	private async buildNoteContent(files: TFile[], headerEmoji: string, activeFile: TFile): Promise<string> {
		let content = "";
		if (!LongtimeDiary.renderdFileRecord[activeFile.path]) {
			LongtimeDiary.renderdFileRecord[activeFile.path] = [];
		}
		for (const f of files) {
			if (activeFile && f.path === activeFile.path) continue;
			if (LongtimeDiary.renderdFileRecord[activeFile.path].includes(f.path)) break; // 無限ループ回避
			LongtimeDiary.renderdFileRecord[activeFile.path].push(f.path);
			let fileContent = await this.app.vault.read(f);
			// ▼▼▼ LongtimeDiaryコードブロックを検出・置換 ▼▼▼
			// コードブロック（```LongtimeDiary ... ```）を全て検出して置換
			fileContent = fileContent.replace(/```LongtimeDiary[\s\S]*?```/gi, '<span class="ltd-skipped">⚠️ LongtimeDiary block skipped (recursive render prevented)</span>');
			const anchorId = this.generateAnchorId(f);
			// content += `\n<h3 id="${anchorId}">${headerEmoji} ${f.basename}</h3>\n\n${fileContent}\n`;
			const noteLinkId = `longtime-diary-open-link-${anchorId}`;
			content += `\n<h3 id="${anchorId}">${headerEmoji} ${f.basename} <a href="#" data-file-path="${f.path}" id="${noteLinkId}" class="ltd-external-link">[↗]</a></h3>\n\n${fileContent}\n`;
			
		}
		return content;
	}

	/** リンク用のアンカーIDを生成 */
	private generateAnchorId(file: TFile): string {
		// プレフィックスを付けて、ページ内の他のIDとの衝突を避ける
		const prefix = "longtime-diary-anchor-";
		// ファイルパスからHTMLのIDとして使えるようにサニタイズする
		const sanitizedPath = file.path.replace(/[^a-zA-Z0-9]/g, '-');
		return prefix + sanitizedPath;
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

/*
class LongtimeDiarySettingTab extends PluginSettingTab {
	plugin: LongtimeDiary;

	constructor(app: App, plugin: LongtimeDiary) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Created Files Limit')
			.setDesc('The maximum number of files to display that were created on the same day.')
			.addText(text => text
				.setPlaceholder('Enter a number')
				.setValue(this.plugin.settings.createdFilesLimit.toString())
				.onChange(async (value) => {
					const numValue = parseInt(value, 10);
					if (!isNaN(numValue)) {
						this.plugin.settings.createdFilesLimit = numValue;
						await this.plugin.saveSettings();
					}
				}));
	}
}

*/
