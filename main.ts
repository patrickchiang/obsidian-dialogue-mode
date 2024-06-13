import { App, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from 'obsidian';
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';

interface DialoguePluginSettings {
	fadeIntensity: number;
	fadeEnabled: boolean;
}

const DEFAULT_SETTINGS: DialoguePluginSettings = {
	fadeIntensity: 100,
	fadeEnabled: true
}

class ColorUtility {
	settings: DialoguePluginSettings;

	constructor(settings: DialoguePluginSettings) {
		this.settings = settings;
	}

	updateFadeColor() {
		if (!this.settings.fadeEnabled) {
			document.body.style.setProperty('--adjusted-color', 'inherit');
			return;
		}

		const fadeIntensity = this.settings.fadeIntensity

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
	}

	hexToRgb(hex: string) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return { r, g, b };
	}

	lerp(start: number, end: number, t: number) {
		return start + (end - start) * t;
	}
}

export default class DialoguePlugin extends Plugin {
	settings: DialoguePluginSettings;
	lastActiveMarkdownLeaf: WorkspaceLeaf | null = null;
	colorUtility: ColorUtility;

	async onload() {
		await this.loadSettings();

		this.colorUtility = new ColorUtility(this.settings);

		this.addSettingTab(new DialoguePluginSettingsTab(this.app, this));

		this.registerMarkdownPostProcessor((element, context) => {
			this.highlightDialog(element);
		});

		this.registerEditorExtension(this.dialogHighlighterExtension());

		this.addCommand({
			id: 'toggle-dialogue-mode',
			name: 'Toggle dialogue mode',
			callback: () => this.toggleFadeOut(),
		});
	}

	toggleFadeOut() {
		this.settings.fadeEnabled = !this.settings.fadeEnabled;
		this.saveSettings();
		new Notice(`Dialogue fade out ${this.settings.fadeEnabled ? 'enabled' : 'disabled'}`);
		this.colorUtility.updateFadeColor();
	}

	highlightDialog(element: HTMLElement) {
		this.colorUtility.updateFadeColor();

		const textNodes = this.getTextNodes(element);

		textNodes.forEach(node => {
			const text = node.nodeValue || "";
			const newContent = this.processTextForDialogue(text);

			if (newContent !== text) {
				const wrapper = document.createElement('span');
				wrapper.innerHTML = newContent;
				node.parentNode?.replaceChild(wrapper, node);
			}
		});
	}

	processTextForDialogue(text: string): string {
		const openQuotes = ['"', '“', '‘'];
		const closeQuotes = ['"', '”', '’'];
		let inDialog = false;
		let result = '';
		let buffer = '';

		for (let i = 0; i < text.length; i++) {
			const char = text[i];

			if (inDialog) {
				buffer += char;
				if (closeQuotes.includes(char) && (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '.' || text[i + 1] === ',')) {
					inDialog = false;
					result += buffer;
					buffer = '';
				}
			} else {
				if (openQuotes.includes(char)) {
					inDialog = true;
					if (buffer) {
						result += `<span class="non-dialogue-text">${buffer}</span>`;
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
				result += buffer;
			} else {
				result += `<span class="non-dialogue-text">${buffer}</span>`;
			}
		}

		return result;
	}

	getTextNodes(element: HTMLElement): Text[] {
		const textNodes: Text[] = [];
		const nodesToVisit: Node[] = [element];

		while (nodesToVisit.length > 0) {
			const currentNode = nodesToVisit.pop();
			if (currentNode) {
				if (currentNode.nodeType === Node.TEXT_NODE) {
					textNodes.push(currentNode as Text);
				} else {
					nodesToVisit.push(...Array.from(currentNode.childNodes));
				}
			}
		}

		return textNodes;
	}

	dialogHighlighterExtension() {
		return ViewPlugin.define(view => new DialogueEditorExtension(view, this.colorUtility), {
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
	colorUtility: ColorUtility;

	constructor(view: EditorView, colorUtility: ColorUtility) {
		this.decorations = this.buildDecorations(view);
		this.colorUtility = colorUtility;
	}

	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged) {
			this.decorations = this.buildDecorations(update.view);
			this.colorUtility.updateFadeColor();
		}
	}

	buildDecorations(view: EditorView) {
		const builder = [];
		const openQuotes = ['"', '“', '‘'];
		const closeQuotes = ['"', '”', '’'];
		let inDialog = false;
		let bufferStart = 0;

		for (const { from, to } of view.visibleRanges) {
			for (let pos = from; pos <= to;) {
				const line = view.state.doc.lineAt(pos);
				const text = line.text;
				bufferStart = line.from;

				for (let i = 0; i < text.length; i++) {
					const char = text[i];

					if (inDialog) {
						if (closeQuotes.includes(char) && (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '.' || text[i + 1] === ',')) {
							inDialog = false;
							bufferStart = line.from + i + 1;
						}
					} else {
						if (openQuotes.includes(char)) {
							inDialog = true;
							if (bufferStart < line.from + i) {
								builder.push(Decoration.mark({ class: 'non-dialogue-text' }).range(bufferStart, line.from + i));
							}
							bufferStart = line.from + i;
						}
					}
				}

				// Append any remaining buffer
				if (bufferStart < line.to) {
					if (!inDialog) {
						builder.push(Decoration.mark({ class: 'non-dialogue-text' }).range(bufferStart, line.to));
					}
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
						this.plugin.colorUtility.updateFadeColor();
					});
			});
	}
}