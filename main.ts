import { App, Plugin, Modal, Editor, EditorPosition, MarkdownView, Notice, PluginSettingTab, Setting } from 'obsidian';
import moment from 'moment-timezone';

// Remember to rename these classes and interfaces!

interface DiscordTimestampsSettings {
    codeblocks: boolean;
    mdCodeblocks: boolean;
    history: string[];
    historyCount: number;
    autoDetectTimezone: boolean;
    localTimezone: string;
}

const DEFAULT_SETTINGS: DiscordTimestampsSettings = {
    codeblocks: false,
    mdCodeblocks: true,
    history: [],
    historyCount: 5,
    autoDetectTimezone: true,
    localTimezone: 'Universal'
}

interface Timezones {
    name: string;
    abbr: string;
}

export default class DiscordTimestamps extends Plugin {
    settings: DiscordTimestampsSettings;
    timezones: Timezones[];

    async onload() {
        await this.loadSettings();
        const plugin = this;

        if (this.settings.autoDetectTimezone) {
            const localTimezone = moment.tz.guess(true);
            this.settings.localTimezone = localTimezone;
            void this.saveSettings();
        }

        function processTimestamp(match: RegExpExecArray) {
            const unixSeconds = Number(match[1]);

            if (!Number.isSafeInteger(unixSeconds)) {
                return null;
            }

            const time = moment.unix(unixSeconds);

            if (!time.isValid()) {
                return null;
            }

            let format;
            let timeParsed = "";
            switch (match[2]) {
                case "d":
                    format = "L";
                    break;
                case "D":
                    format = "LL";
                    break;
                case "t":
                    format = "LT";
                    break;
                case "T":
                    format = "LTS";
                    break;
                case "f":
                    format = "LLL";
                    break;
                case "F":
                    format = "LLLL";
                    break;
                case "R":
                    timeParsed = time.fromNow();
                    break;
                default:
                    return null;
            }
            if (timeParsed == "") {
                timeParsed = time.tz(plugin.settings.localTimezone).format(format);
            }
            return {
                timeParsed: timeParsed,
                full: time.tz(plugin.settings.localTimezone).format("LLLL")
            };
        }

        function replaceTimestamp(element: HTMLElement) {
            if (element.localName == "code" && (plugin.settings.codeblocks == false || (element.hasClass('language-md') && plugin.settings.mdCodeblocks == true))) {
                return;
            }
            else if (element.nodeType == element.TEXT_NODE) {
                let text = element.textContent || "";
                const originalText = text;
                if (text == null || text == "") {
                    return element;
                }
                let match;
                let textSlices: string[] = [];
                let timestampSlices: string[] = [];
                let timestampHover: string[] = [];
                while ((match = /<t:(-?\d+):([dDtTfFR])>/g.exec(text)) !== null) {
                    let timestamp = processTimestamp(match);

                    if (timestamp === null)
                        continue;

                    textSlices.push(text.slice(0, text.indexOf(match[0])))
                    text = text.slice(text.indexOf(match[0]) + match[0].length);
                    timestampSlices.push(timestamp.timeParsed);
                    timestampHover.push(timestamp.full);
                }
                if (text !== originalText) {
                    let newEl = new DocumentFragment;
                    for (let i = 0; i < textSlices.length; i++) {
                        if (i == 0) {
                            newEl.textContent = textSlices[i]
                        }
                        else {
                            newEl.appendText(textSlices[i]);
                        }
                        if (i < timestampSlices.length && i < timestampHover.length) {
                            let timestampEl = newEl.createEl('span', { text: timestampSlices[i], cls: 'discord-timestamps' });
                            timestampEl.ariaLabel = timestampHover[i];
                            timestampEl.ontouchend = (ev) => {
                                new Notice(timestampHover[i]);
                            }
                        }
                        else if (timestampSlices.length !== timestampHover.length) {
                            console.error("The lengths of timestampSlices and timestampHover are NOT EQUAL!");
                        }
                    }
                    if (text !== "") {
                        newEl.appendText(text);
                    }

                    element.replaceWith(newEl);
                }
            }
            else if (element.nodeType == element.ELEMENT_NODE) {
                let child = element.firstChild as HTMLElement;
                /* let children = Array.from(element.children);
                for (let child of children) {
                    replaceTimestamp(child as HTMLElement)
                } */
                while (child) {
                    const nextChild = child.nextSibling;
                    replaceTimestamp(child);
                    child = nextChild as HTMLElement;
                }
            }
        }

        this.registerMarkdownPostProcessor((element, context) => {
            replaceTimestamp(element);
        });

        this.registerMarkdownPostProcessor((element, context) => {
            if (!plugin.settings.mdCodeblocks)
                return;

            let elements = element.findAll('code span.token.tag');

            for (let el of elements) {
                let text = el.textContent;
                if (!text)
                    continue;
                const match = /^<t:(-?\d+):([dDtTfFR])>$/.exec(text);
                if (!match)
                    continue;

                let timestamp = processTimestamp(match);

                if (timestamp === null)
                    continue;

                let newEl = new DocumentFragment

                let timestampEl = newEl.createEl('span', { text: timestamp.timeParsed, cls: 'discord-timestamps' });
                let timestampHover = timestamp.full;
                timestampEl.ariaLabel = timestampHover;
                timestampEl.ontouchend = (ev) => {
                    new Notice(timestampHover);
                }

                el.replaceWith(newEl);
            }

            let elements2 = element.findAll('code span.token.content');
            for (let el of elements2) {
                replaceTimestamp(el);
            }
        }, 1000)

        this.addCommand({
            id: 'insert-timestamp',
            name: 'Insert Discord timestamp',
            icon: 'lucide-alarm-clock-plus',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                new TimestampModal(this.app, editor, editor.getCursor(), plugin).open();
            }
        })

        this.registerEvent( //on editor menu
            this.app.workspace.on("editor-menu", (menu, editor, info) => {
                menu.addSeparator();

                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (view) {
                    menu.addItem(item => {
                        item
                            .setTitle('Insert Discord timestamp')
                            .setIcon('lucide-alarm-clock-plus')
                            .onClick(() => {
                                new TimestampModal(this.app, editor, editor.getCursor(), plugin).open();
                            })
                    });
                }

            })

        );

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new DiscordTimestampsSettingTab(this.app, this));

        function setTimezones() {
            let zoneNames = moment.tz.names();
            let timezones: Timezones[] = [];
            // let abbreviations: string[] = [];

            for (let name of zoneNames) {
                const zone = moment.tz(name);
                const abbr = zone.zoneAbbr();
                timezones.push({
                    name: name,
                    abbr: abbr
                });
            }

            /* timezones.sort(function (zoneA, zoneB) {
                const stringA = zoneA.offset.replace(':', '');
                const stringB = zoneB.offset.replace(':', "");
                const intA = parseInt(stringA);
                const intB = parseInt(stringB);
                return intB - intA;
            }) */
            return timezones;
        }

        plugin.timezones = setTimezones();

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

class TimestampModal extends Modal {
    editor: Editor;
    view: MarkdownView;
    cursor: EditorPosition;
    plugin: DiscordTimestamps;

    constructor(app: App, editor: Editor, cursor: EditorPosition, plugin: DiscordTimestamps) {
        super(app);
        this.editor = editor;
        this.cursor = cursor;
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl, editor, cursor, plugin } = this;
        const modal = this;

        const localTimezone = plugin.settings.localTimezone;

        //#region input div
        let inputDiv = contentEl.createDiv();
        inputDiv.addClass('timestamp-input-div')

        //#region time input
        inputDiv.createEl('label', { text: 'Choose a time', cls: 'timestamp-label' });
        let input = inputDiv.createEl('input', {
            cls: 'timestamp-input',
            attr: {
                type: 'datetime-local'
            }
        })
        const now = moment().tz(localTimezone);
        input.value = now.format("YYYY-MM-DD[T]kk:mm:ss");
        //#endregion

        inputDiv.createEl('br');

        //#region time zone
        const timezoneDiv = contentEl.createDiv()
        timezoneDiv.addClass('timestamp-input-div')

        timezoneDiv.createEl('label', {
            text: 'Choose a time zone', cls: 'timestamp-label',
            attr: {
                id: 'timezone-label'
            }
        });
        let timezone = timezoneDiv.createEl('select', {
            cls: 'timezone-options',
            attr: {
                id: 'timezone',
                name: 'timezone'
            }
        })

        for (let zone of plugin.timezones) {
            timezone.createEl('option', {
                text: `${zone.name} (${zone.abbr})`,
                cls: 'timezone-option',
                attr: {
                    value: zone.name
                }
            })
        }


        timezone.value = localTimezone;

        timezone.onchange = (ev: Event) => {
            const offset = (ev.target as HTMLInputElement).value;
            const date = moment.tz(input.value, moment.ISO_8601, offset)

            setClickEvents(date);
        }
        //#endregion

        //#endregion

        if (plugin.settings.history.length > 0) {
            contentEl.createEl('h3', { text: 'Or', cls: 'timestamp-button-heading' })
            const historyDiv = contentEl.createDiv();
            historyDiv.addClass('timestamp-input-div')
            historyDiv.createEl('label', {
                text: 'Choose from history', cls: 'timestamp-label', attr: {
                    id: 'timestamp-history-label'
                }
            })
            let history = historyDiv.createEl('select', {
                attr: {
                    id: 'history',
                    name: 'history'
                }
            })

            history.createEl('option', {
                text: 'Select one',
                attr: {
                    hidden: true
                }
            })

            for (let timestamp of plugin.settings.history) {
                const slices = timestamp.split(" ");

                const time = moment.tz(slices[0], moment.ISO_8601, slices[1]);
                history.createEl('option', {
                    text: time.format('LLLL') + " " + time.zoneAbbr(),
                    attr: {
                        value: timestamp
                    }
                })
            }

            history.onchange = (ev: Event) => {
                const timeString = (ev.target as HTMLInputElement).value;
                const slices = timeString.split(" ");

                input.value = slices[0];
                timezone.value = slices[1];

                const date = moment.tz(slices[0], moment.ISO_8601, slices[1]);

                setClickEvents(date);
            }
        }

        contentEl.createEl('h2', { text: 'Pick your format', cls: 'timestamp-button-heading' })

        const div = contentEl.createDiv();


        div.addClass('timestamp-button-container')

        function setClickEvents(date: moment.Moment) {
            div.empty();
            //#region add buttons
            const button_d = div.createEl('button');
            button_d.id = "d";
            const button_D = div.createEl('button');
            button_D.id = "D";
            const button_t = div.createEl('button');
            button_t.id = "t";
            const button_T = div.createEl('button');
            button_T.id = "T";
            const button_f = div.createEl('button');
            button_f.id = "f";
            const button_F = div.createEl('button');
            button_F.id = "F";
            const button_R = div.createEl('button');
            button_R.id = "R";
            const button_unix = div.createEl('button');
            button_unix.id = "unix";
            //#endregion

            //#region set button content
            button_d.textContent = date.tz(localTimezone).format('L');
            button_D.textContent = date.tz(localTimezone).format('LL');
            button_t.textContent = date.tz(localTimezone).format('LT');
            button_T.textContent = date.tz(localTimezone).format('LTS');
            button_f.textContent = date.tz(localTimezone).format('LLL');
            button_F.textContent = date.tz(localTimezone).format('LLLL');
            button_R.textContent = date.tz(localTimezone).fromNow();
            button_unix.textContent = date.tz(localTimezone).format('X');
            //#endregion

            let child = div.firstChild as HTMLElement;
            while (child) {
                const nextChild = child.nextSibling;
                child.addClass('timestamp-buttons');
                let timestampStr: string;
                if (child.id == "unix")
                    timestampStr = date.utc().format('X');
                else
                    timestampStr = `<t:${date.utc().format('X')}:${child.id}>`;
                child.ariaLabel = timestampStr;
                child.onClickEvent((ev) => {
                    editor.replaceSelection(timestampStr);
                    editor.setCursor(cursor.line, cursor.ch + timestampStr.length);

                    let historyList = plugin.settings.history;
                    let newTimestamp = `${input.value} ${timezone.value}`
                    if (historyList.includes(newTimestamp) == false) {
                        historyList.unshift(newTimestamp)
                        const historyCount = plugin.settings.historyCount;
                        if (historyList.length > historyCount) {
                            historyList = historyList.slice(0, historyCount)
                        }
                        plugin.settings.history = historyList;

                        void plugin.saveSettings();
                    }


                    modal.close();
                })
                child = nextChild as HTMLElement;
            }
        }

        setClickEvents(now);

        input.onchange = (ev: Event) => {
            const value = (ev.target as HTMLInputElement).value;
            const offset = timezone.value;
            const date = moment.tz(value, moment.ISO_8601, offset)

            setClickEvents(date);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class DiscordTimestampsSettingTab extends PluginSettingTab {
    plugin: DiscordTimestamps;

    constructor(app: App, plugin: DiscordTimestamps) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        function addReloadError(text: string | DocumentFragment) {
            const frag = new DocumentFragment;
            if (typeof text === 'string') {
                const textSlices = text.split('\n');

                frag.textContent = textSlices[0];
                for (let i = 1; i < textSlices.length; i++) {
                    frag.createEl('br');
                    frag.appendText(textSlices[i])
                }
            }
            else if (text instanceof DocumentFragment) {
                frag.appendChild(text)
            }

            frag.createEl('br');
            frag.createEl('span', { text: 'Changing this requires reopening the active note.', cls: 'setting-error' })
            return frag;
        }

        //#region conversion overrides
        new Setting(containerEl)
            .setName('Conversion overrides')
            .setHeading();

        new Setting(containerEl)
            .setName('Convert code blocks')
            .setDesc(addReloadError('Disable this to avoid converting timestamps within code blocks.'))
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.codeblocks)
                    .onChange((value) => {
                        this.plugin.settings.codeblocks = value;
                        void this.plugin.saveSettings();
                        // await this.plugin.loadSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Override markdown code blocks')
            .setDesc(addReloadError('Enable this to override markdown code blocks with this plugin\'s default class and appearance when converting timestamps.'))
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.mdCodeblocks)
                    .onChange((value) => {
                        this.plugin.settings.mdCodeblocks = value;
                        void this.plugin.saveSettings();
                        // await this.plugin.loadSettings();
                    })
            );
        //#endregion

        //#region history
        new Setting(containerEl)
            .setName('History')
            .setHeading();

        new Setting(containerEl)
            .setName('History size')
            .setDesc('The maximum number of timestamps that will be stored in the history.')
            .addSlider(slider => slider
                .setLimits(0, 10, 1)
                .setValue(this.plugin.settings.historyCount)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.historyCount = value;
                    let historyList = this.plugin.settings.history;
                    if (historyList.length > value) {
                        historyList = historyList.slice(0, value)
                    }
                    this.plugin.settings.history = historyList;
                    void this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Clear history')
            .setDesc('Press this button to clear the cached history.')
            .addButton((button) => {
                button
                    .setIcon('lucide-trash-2')
                    .setWarning()
                    .onClick((ev: MouseEvent) => {
                        this.plugin.settings.history = [];
                        void this.plugin.saveSettings();
                    })
            });
        //#endregion

        //#region time zone
        new Setting(containerEl)
            .setName('Time zone')
            .setHeading();

        new Setting(containerEl)
            .setName('Auto-detect time zone')
            .setDesc(addReloadError('Enable this to auto-detect your local time zone.'))
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.autoDetectTimezone)
                    .onChange((value) => {
                        this.plugin.settings.autoDetectTimezone = value;
                        const localTimezone = moment.tz.guess(true);
                        this.plugin.settings.localTimezone = localTimezone;
                        void this.plugin.saveSettings();
                        this.display();

                    })
            );

        const timezoneFrag = new DocumentFragment;
        timezoneFrag.textContent = 'The time zone timestamps will be displayed in.';
        timezoneFrag.createEl('br');
        timezoneFrag.createEl('strong', { text: 'Auto-detect time zone' });
        timezoneFrag.appendText(' must be ');
        timezoneFrag.createEl('strong', { text: 'disabled' });
        timezoneFrag.appendText(' to change this.');

        new Setting(containerEl)
            .setName('Local time zone')
            .setDesc(addReloadError(timezoneFrag))
            .addDropdown((dropdown) => {
                for (let timezone of this.plugin.timezones) {
                    dropdown.addOption(timezone.name, `${timezone.name} (${timezone.abbr})`)
                }

                dropdown
                    .setValue(this.plugin.settings.localTimezone)
                    .onChange((value) => {
                        this.plugin.settings.localTimezone = value;
                        void this.plugin.saveSettings();
                    })
                if (this.plugin.settings.autoDetectTimezone) {
                    dropdown.setDisabled(true);
                }
                else {
                    dropdown.setDisabled(false);
                }
            });
        //#endregion

    }
}
