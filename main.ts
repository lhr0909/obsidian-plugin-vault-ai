import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  addIcon,
} from "obsidian";
import OpenAI, { toFile } from "openai";
import mime from 'mime';
// import axios from 'axios';

import { NativeAudioRecorder } from "./recorder";

// Remember to rename these classes and interfaces!

interface OpenAIPluginSettings {
  apiKey: string;
  audioPath: string;
}

const DEFAULT_SETTINGS: OpenAIPluginSettings = {
  apiKey: "sk-xxx",
  audioPath: "audio-notes",
};

addIcon(
  "captions",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-captions"><rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/></svg>`,
);

export default class OpenAIPlugin extends Plugin {
  settings: OpenAIPluginSettings;
  openai: OpenAI;
  recorder: NativeAudioRecorder;
  recording = false;

  async onload() {
    await this.loadSettings();

    this.openai = new OpenAI({
      apiKey: this.settings.apiKey,
      dangerouslyAllowBrowser: true,
    });

    this.recorder = new NativeAudioRecorder();

    this.addRibbonIcon(
      "microphone",
      "Start / Stop Recording",
      async (evt: MouseEvent) => {
        if (!this.recording) {
          await this.recorder.startRecording();
          this.recording = true;
          new Notice("Recording started!");
          return;
        }

        // store the blob in the vault
        const audioBlob = await this.recorder.stopRecording();
        const extension = this.recorder
          .getMimeType()
          ?.split("/")[1];
        const fileName = `${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.${extension}`;

        const arrayBuffer = await audioBlob.arrayBuffer();
        await this.app.vault.adapter.writeBinary(
          `${this.settings.audioPath}/${fileName}`,
          new Uint8Array(arrayBuffer)
        );
        new Notice("Recording saved!");
        this.recording = false;
      },
    )

    // This creates an icon in the left ribbon.
    const ribbonIconEl = this.addRibbonIcon(
      "captions",
      "Transcribe",
      async (evt: MouseEvent) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          // Get all linked files in the markdown file
          const filesLinked = Object.keys(
            this.app.metadataCache.resolvedLinks[activeFile.path]
          );

          for (const linkedFilePath of filesLinked) {
            // Get the binary content of the files
            const linkedFile = this.app.vault.getAbstractFileByPath(linkedFilePath);
            if (linkedFile instanceof TFile) {
              console.log(linkedFile);
              const fileContent = await this.app.vault.readBinary(linkedFile);
              console.log(fileContent);

              const transcription = await this.openai.audio.transcriptions.create({
                model: 'whisper-1',
                response_format: 'verbose_json',
                file: await toFile(fileContent, linkedFile.name, {
                  type: mime.getType(linkedFile.name) || "application/octet-stream",
                }),
              });

              // const formData = new FormData();
              // formData.append('file', new Blob([fileContent], {
              //   type: mime.getType(linkedFile.name) || "application/octet-stream",
              // }), linkedFile.name);
              // formData.append('model', 'whisper-1');
              // formData.append('response_format', 'verbose_json');

              // // axios to POST the form to https://api.openai.com/v1/audio/transcriptions

              // const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
              //   headers: {
              //     'Content-Type': 'multipart/form-data',
              //     Authorization: `Bearer ${this.settings.apiKey}`,
              //   },
              // });

              // const transcription = response.data;

              await this.app.vault.process(activeFile, (data) => {
                // look for the linked file in the markdown file
                const encodedFilePath = encodeURI(linkedFile.path);
                const encodedFilename = encodeURI(linkedFile.name);
                const regexString = `\\[\\[(${encodedFilename})\\]\\]|!\\[\\]\\((${encodedFilename})\\)|\\[\\[(${encodedFilePath})\\]\\]|!\\[\\]\\((${encodedFilePath})\\)`;
                const regex = new RegExp(regexString, "g");

                const result = regex.exec(data);

                console.log(result);

                if (result) {
                  // replace the linked file with the transcription
                  const replaced = data.replace(regex, `${result?.[0]}\n\n${transcription.text}`);
                  return replaced;
                }

                return data;
              });
            }
          }

        }

        // Called when the user clicks the icon.
        new Notice("Transcription finished!");
      },
    );
    // Perform additional things with the ribbon
    ribbonIconEl.addClass("my-plugin-ribbon-class");

    // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
    const statusBarItemEl = this.addStatusBarItem();
    statusBarItemEl.setText("Whisper Idle");

    // This adds a simple command that can be triggered anywhere
    // this.addCommand({
    //   id: "open-sample-modal-simple",
    //   name: "Open sample modal (simple)",
    //   callback: () => {
    //     new SampleModal(this.app).open();
    //   },
    // });
    // This adds an editor command that can perform some operation on the current editor instance
    // this.addCommand({
    //   id: "transcribe-current",
    //   name: "Transcribe Contents in Current File",
    //   editorCallback: (editor: Editor, view: MarkdownView) => {
    //     console.log(editor.getSelection());
    //     editor.replaceSelection("Sample Editor Command");
    //   },
    // });
    // This adds a complex command that can check whether the current state of the app allows execution of the command
    // this.addCommand({
    //   id: "open-sample-modal-complex",
    //   name: "Open sample modal (complex)",
    //   checkCallback: (checking: boolean) => {
    //     // Conditions to check
    //     const markdownView =
    //       this.app.workspace.getActiveViewOfType(MarkdownView);
    //     if (markdownView) {
    //       // If checking is true, we're simply "checking" if the command can be run.
    //       // If checking is false, then we want to actually perform the operation.
    //       if (!checking) {
    //         new SampleModal(this.app).open();
    //       }

    //       // This command will only show up in Command Palette when the check function returns true
    //       return true;
    //     }
    //   },
    // });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new OpenAISettingsTab(this.app, this));

    // If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
    // Using this function will automatically remove the event listener when this plugin is disabled.
    // this.registerDomEvent(document, "click", (evt: MouseEvent) => {
    //   console.log("click", evt);
    // });

    // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
    // this.registerInterval(
    //   window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000),
    // );
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class SampleModal extends Modal {
  // biome-ignore lint/complexity/noUselessConstructor: <explanation>
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.setText("Woah!");
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class OpenAISettingsTab extends PluginSettingTab {
  plugin: OpenAIPlugin;

  constructor(app: App, plugin: OpenAIPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName("OpenAI API Key")
      .setDesc("We use your OpenAI API key to use its API functions.")
      .addText((text) =>
        text
          .setPlaceholder("Enter your secret")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
            // this.plugin.openai = new OpenAI({
            //   apiKey: this.plugin.settings.apiKey,
            //   dangerouslyAllowBrowser: true,
            // });
          }),
      );
  }
}
