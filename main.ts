import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from 'obsidian';
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';

interface DialoguePluginSettings {
	fadeIntensity: number;
	fadeEnabled: boolean;
	modifyDialogueColor: boolean;
	dialogueColor: string;
}

const DEFAULT_SETTINGS: DialoguePluginSettings = {
	fadeIntensity: 100,
	fadeEnabled: true,
	modifyDialogueColor: false,
	dialogueColor: '#FFFFFF'
}

class ColorUtility {
	static updateFadeColor(settings: DialoguePluginSettings) {
		if (!settings.fadeEnabled) {
			document.body.style.setProperty('--adjusted-color', 'inherit');
			return;
		}

		const fadeIntensity = settings.fadeIntensity

		const baseColor = getComputedStyle(document.body).getPropertyValue('--text-normal').trim();
		const fadeColor = getComputedStyle(document.body).getPropertyValue('--dialogue-excluded-text-color').trim();

		const baseRGB = this.hexToRgb(baseColor);
		const fadeRGB = this.hexToRgb(fadeColor);
		const blendRGB = {
			r: Math.round(this.lerp(baseRGB.r, fadeRGB.r, fadeIntensity / 100)),
			g: Math.round(this.lerp(baseRGB.g, fadeRGB.g, fadeIntensity / 100)),
			b: Math.round(this.lerp(baseRGB.b, fadeRGB.b, fadeIntensity / 100))
		};

		const blendedColor = `rgb(${blendRGB.r}, ${blendRGB.g}, ${blendRGB.b})`;
		document.body.style.setProperty('--adjusted-color', blendedColor);

		if (settings.modifyDialogueColor) {
			document.body.style.setProperty('--dialogue-text-color', settings.dialogueColor);
		} else {
			document.body.style.setProperty('--dialogue-text-color', baseColor);
		}
	}

	static hexToRgb(hex: string) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return { r, g, b };
	}

	static lerp(start: number, end: number, t: number) {
		return start + (end - start) * t;
	}
}

export default class DialoguePlugin extends Plugin {
	settings: DialoguePluginSettings;
	lastActiveMarkdownLeaf: WorkspaceLeaf | null = null;
	toggleChanged: boolean;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new DialoguePluginSettingsTab(this.app, this));

		this.registerMarkdownPostProcessor((element, context) => {
			if (this.settings.fadeEnabled) {
				this.highlightDialog(element);
			}
		});

		this.registerEditorExtension(this.dialogHighlighterExtension());

		this.addCommand({
			id: 'toggle-dialogue-mode',
			name: 'Toggle dialogue mode',
			callback: () => {
				this.toggleChanged = true;
				this.toggleFadeOut();

				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				markdownView?.previewMode.rerender(true);
			},
		});
	}

	toggleFadeOut() {
		this.settings.fadeEnabled = !this.settings.fadeEnabled;
		this.saveSettings();
		new Notice(`Dialogue fade out ${this.settings.fadeEnabled ? 'enabled' : 'disabled'}`);
		ColorUtility.updateFadeColor(this.settings);
	}

	highlightDialog(element: HTMLElement) {
		ColorUtility.updateFadeColor(this.settings);

		const textNodes = this.getTextNodes(element);

		let inDialog = false;

		textNodes.forEach(node => {
			const text = node.nodeValue || "";
			const newContent = this.processTextForDialogue(text, inDialog);
			inDialog = newContent.inDialog;

			if (newContent.text.join('') !== text) {
				const wrapper = this.createWrapper(newContent.text);
				if (node.parentNode) {
					node.parentNode.replaceChild(wrapper, node);
				}
			}
		});
	}

	processTextForDialogue(text: string, inDialog: boolean): { text: (string | HTMLElement)[], inDialog: boolean } {
		const openQuotes = ['"', '“', '‘'];
		const closeQuotes = ['"', '”', '’'];
		const result = [];
		let buffer = '';

		for (let i = 0; i < text.length; i++) {
			const char = text[i];

			if (inDialog) {
				buffer += char;
				if (closeQuotes.includes(char) && (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '.' || text[i + 1] === ',')) {
					inDialog = false;
					const span = document.createElement('span');
					span.className = 'dialogue-text';
					span.appendChild(document.createTextNode(buffer));
					result.push(span);
					buffer = '';
				}
			} else {
				if (openQuotes.includes(char)) {
					inDialog = true;
					if (buffer) {
						const span = document.createElement('span');
						span.className = 'non-dialogue-text';
						span.appendChild(document.createTextNode(buffer));
						result.push(span);
						buffer = '';
					}
					buffer += char;
				} else {
					buffer += char;
				}
			}
		}

		if (buffer) {
			if (inDialog) {
				const span = document.createElement('span');
				span.className = 'dialogue-text';
				span.appendChild(document.createTextNode(buffer));
				result.push(span);
			} else {
				const span = document.createElement('span');
				span.className = 'non-dialogue-text';
				span.appendChild(document.createTextNode(buffer));
				result.push(span);
			}
		}

		return { text: result, inDialog: inDialog };
	}

	createWrapper(content: (string | HTMLElement)[]): HTMLElement {
		const wrapper = document.createElement('span');
		content.forEach(item => {
			if (typeof item === 'string') {
				wrapper.appendChild(document.createTextNode(item));
			} else {
				wrapper.appendChild(item);
			}
		});
		return wrapper;
	}

	getTextNodes(element: HTMLElement): Text[] {
		const textNodes: Text[] = [];
		const nodesToVisit: Node[] = [element];

		while (nodesToVisit.length > 0) {
			const currentNode = nodesToVisit.shift();
			if (currentNode) {
				if (currentNode.nodeType === Node.TEXT_NODE) {
					textNodes.push(currentNode as Text);
				} else {
					nodesToVisit.unshift(...Array.from(currentNode.childNodes));
				}
			}
		}
		return textNodes;
	}

	dialogHighlighterExtension() {
		return ViewPlugin.define(view => new DialogueEditorExtension(view, this), {
			decorations: v => v.decorations
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class DialogueEditorExtension {
	decorations: DecorationSet;
	plugin: DialoguePlugin;

	constructor(view: EditorView, plugin: DialoguePlugin) {
		this.plugin = plugin;
		this.decorations = this.buildDecorations(view);
	}

	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged || this.plugin.toggleChanged) {
			this.decorations = this.buildDecorations(update.view);
			ColorUtility.updateFadeColor(this.plugin.settings);
			this.plugin.toggleChanged = false;
		}
	}

	buildDecorations(view: EditorView) {
		if (!this.plugin.settings.fadeEnabled) {
			return Decoration.none;
		}

		const builder = [];
		const openQuotes = ['"', '“', '‘'];
		const closeQuotes = ['"', '”', '’'];
		const quoteStack: Array<{ quote: string, pos: number }> = [];
		let bufferStart = 0;

		for (const { from, to } of view.visibleRanges) {
			for (let pos = from; pos <= to;) {
				const line = view.state.doc.lineAt(pos);
				const text = line.text;
				bufferStart = line.from;

				for (let i = 0; i < text.length; i++) {
					const char = text[i];
					const openIndex = openQuotes.indexOf(char);
					const closeIndex = closeQuotes.indexOf(char);

					if (openIndex !== -1) {
						quoteStack.push({ quote: char, pos: line.from + i });
						if (bufferStart < line.from + i) {
							builder.push(Decoration.mark({ class: 'non-dialogue-text' }).range(bufferStart, line.from + i));
						}
						bufferStart = line.from + i + 1;
					} else if (closeIndex !== -1 && quoteStack.length > 0 && openQuotes.indexOf(quoteStack[quoteStack.length - 1].quote) === closeIndex) {
						// Matching close quote found
						const opening = quoteStack.pop();
						if (opening && opening.pos !== undefined) {
							builder.push(Decoration.mark({ class: 'dialogue-text' }).range(opening.pos, line.from + i + 1));
							bufferStart = line.from + i + 1;
						}
					}
				}

				if (bufferStart < line.to) {
					builder.push(Decoration.mark({ class: 'non-dialogue-text' }).range(bufferStart, line.to));
				}

				pos = line.to + 1;
			}
		}

		return Decoration.set(builder, true);
	}
}

class DialoguePluginSettingsTab extends PluginSettingTab {
	plugin: DialoguePlugin;

	constructor(app: App, plugin: DialoguePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Enable fade effect')
			.setDesc('Enable or disable the fade effect on excluded text.')
			.addToggle(toggle => {
				toggle
					.setValue(this.plugin.settings.fadeEnabled)
					.onChange(async value => {
						this.plugin.settings.fadeEnabled = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Fade intensity')
			.setDesc('The intensity of the fade effect on excluded text.')
			.addSlider(slider => {
				slider
					.setLimits(0, 100, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.fadeIntensity)
					.onChange(async value => {
						this.plugin.settings.fadeIntensity = value;
						await this.plugin.saveSettings();
						ColorUtility.updateFadeColor(this.plugin.settings);
					});
			});

		new Setting(containerEl)
			.setName('Modify dialogue text color')
			.setDesc('Enable or disable the modification of the dialogue text color.')
			.addToggle(toggle => {
				toggle
					.setValue(this.plugin.settings.modifyDialogueColor)
					.onChange(async value => {
						this.plugin.settings.modifyDialogueColor = value;
						await this.plugin.saveSettings();
						this.display();
						ColorUtility.updateFadeColor(this.plugin.settings);
					});
			});

		new Setting(containerEl)
			.setName('Dialogue text color')
			.setDesc('The color of the dialogue text.')
			.addColorPicker(color => {
				color
					.setValue(this.plugin.settings.dialogueColor)
					.setDisabled(!this.plugin.settings.modifyDialogueColor)
					.onChange(async value => {
						this.plugin.settings.dialogueColor = value;
						await this.plugin.saveSettings();
						ColorUtility.updateFadeColor(this.plugin.settings);
					});
			});
	}
}