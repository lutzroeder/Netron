/* jshint esversion: 6 */

const electron = require('electron');
const updater = require('electron-updater');
const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');
const url = require('url');

class Application {

    constructor() {

        this._views = new ViewCollection();
        this._configuration = new ConfigurationService();
        this._menu = new MenuService();
        this._openQueue = [];

        electron.app.setAppUserModelId('com.lutzroeder.netron');
        electron.app.allowRendererProcessReuse = true;

        if (!electron.app.requestSingleInstanceLock()) {
            electron.app.quit();
            return;
        }

        electron.app.on('second-instance', (event, commandLine, workingDirectory) => {
            const currentDirectory = process.cwd();
            process.chdir(workingDirectory);
            const open = this._parseCommandLine(commandLine);
            process.chdir(currentDirectory);
            if (!open) {
                if (this._views.count > 0) {
                    const view = this._views.item(0);
                    if (view) {
                        view.restore();
                    }
                }
            }
        });

        electron.ipcMain.on('open-file-dialog', () => {
            this._openFileDialog();
        });

        electron.ipcMain.on('get-environment', (event) => {
            event.returnValue = {
                version: electron.app.getVersion(),
                package: electron.app.isPackaged,
                zoom: 'drag'
                // zoom: 'scroll'
            };
        });
        electron.ipcMain.on('get-configuration', (event, obj) => {
            event.returnValue = this._configuration.has(obj.name) ? this._configuration.get(obj.name) : undefined;
        });
        electron.ipcMain.on('set-configuration', (event, obj) => {
            this._configuration.set(obj.name, obj.value);
        });
        electron.ipcMain.on('drop-paths', (event, data) => {
            const paths = data.paths.filter((path) => {
                if (fs.existsSync(path)) {
                    const stat = fs.statSync(path);
                    return stat.isFile() || stat.isDirectory();
                }
                return false;
            });
            this._dropPaths(event.sender, paths);
        });
        electron.ipcMain.on('show-message-box', (event, options) => {
            const owner = event.sender.getOwnerBrowserWindow();
            event.returnValue = electron.dialog.showMessageBoxSync(owner, options);
        });
        electron.ipcMain.on('show-save-dialog', (event, options) => {
            const owner = event.sender.getOwnerBrowserWindow();
            event.returnValue = electron.dialog.showSaveDialogSync(owner, options);
        });

        electron.app.on('will-finish-launching', () => {
            electron.app.on('open-file', (event, path) => {
                this._openPath(path);
            });
        });

        electron.app.on('ready', () => {
            this._ready();
        });

        electron.app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                electron.app.quit();
            }
        });

        electron.app.on('will-quit', () => {
            this._configuration.save();
        });

        this._parseCommandLine(process.argv);
        this._checkForUpdates();
    }

    _parseCommandLine(argv) {
        let open = false;
        if (argv.length > 1) {
            for (const arg of argv.slice(1)) {
                if (!arg.startsWith('-') && arg !== path.dirname(__dirname)) {
                    const extension = path.extname(arg).toLowerCase();
                    if (extension != '' && extension != 'js' && fs.existsSync(arg)) {
                        const stat = fs.statSync(arg);
                        if (stat.isFile() || stat.isDirectory()) {
                            this._openPath(arg);
                            open = true;
                        }
                    }
                }
            }
        }
        return open;
    }

    _ready() {
        this._configuration.load();
        if (!this._configuration.has('userId')) {
            this._configuration.set('userId', this._uuid());
        }
        if (this._openQueue) {
            const queue = this._openQueue;
            this._openQueue = null;
            while (queue.length > 0) {
                const file = queue.shift();
                this._openPath(file);
            }
        }
        if (this._views.count == 0) {
            this._views.openView();
        }
        this._resetMenu();
        this._views.on('active-view-changed', () => {
            this._updateMenu();
        });
        this._views.on('active-view-updated', () => {
            this._updateMenu();
        });
    }

    _uuid() {
        const buffer = new Uint8Array(16);
        require("crypto").randomFillSync(buffer);
        buffer[6] = buffer[6] & 0x0f | 0x40;
        buffer[8] = buffer[8] & 0x3f | 0x80;
        const text = Array.from(buffer).map((value) => value < 0x10 ? '0' + value.toString(16) : value.toString(16)).join('');
        return text.slice(0, 8) + '-' + text.slice(8, 12) + '-' + text.slice(12, 16) + '-' + text.slice(16, 20) + '-' + text.slice(20, 32);
    }

    _openFileDialog() {
        const showOpenDialogOptions = {
            properties: [ 'openFile' ],
            filters: [
                { name: 'All Model Files',  extensions: [
                    'onnx', 'pb',
                    'h5', 'hd5', 'hdf5', 'json', 'keras',
                    'mlmodel', 'mlpackage',
                    'caffemodel',
                    'model', 'dnn', 'cmf', 'mar', 'params',
                    'pdmodel', 'pdparams',
                    'meta',
                    'tflite', 'lite', 'tfl',
                    'armnn', 'mnn', 'nn', 'uff', 'uff.txt', 'rknn', 'xmodel',
                    'ncnn', 'param', 'tnnproto', 'tmfile', 'ms',
                    'pt', 'pth', 't7',
                    'pkl', 'joblib',
                    'pbtxt', 'prototxt',
                    'cfg', 'xml',
                    'zip', 'tar' ] }
            ]
        };
        const selectedFiles = electron.dialog.showOpenDialogSync(showOpenDialogOptions);
        if (selectedFiles) {
            for (const file of selectedFiles) {
                this._openPath(file);
            }
        }
    }

    _openPath(path) {
        if (this._openQueue) {
            this._openQueue.push(path);
            return;
        }
        if (path && path.length > 0 && fs.existsSync(path)) {
            const stat = fs.statSync(path);
            if (stat.isFile() || stat.isDirectory()) {
                // find existing view for this file
                let view = this._views.find(path);
                // find empty welcome window
                if (view == null) {
                    view = this._views.find(null);
                }
                // create new window
                if (view == null) {
                    view = this._views.openView();
                }
                this._loadPath(path, view);
            }
        }
    }

    _loadPath(path, view) {
        const recents = this._configuration.get('recents').filter((recent) => path != recent.path);
        view.open(path);
        recents.unshift({ path: path });
        if (recents.length > 9) {
            recents.splice(9);
        }
        this._configuration.set('recents', recents);
        this._resetMenu();
    }

    _dropPaths(sender, paths) {
        let view = this._views.from(sender);
        for (const path of paths) {
            if (view) {
                this._loadPath(path, view);
                view = null;
            }
            else {
                this._openPath(path);
            }
        }
    }

    _export() {
        const view = this._views.activeView;
        if (view && view.path) {
            let defaultPath = 'Untitled';
            const file = view.path;
            const lastIndex = file.lastIndexOf('.');
            if (lastIndex != -1) {
                defaultPath = file.substring(0, lastIndex);
            }
            const owner = electron.BrowserWindow.getFocusedWindow();
            const showSaveDialogOptions = {
                title: 'Export',
                defaultPath: defaultPath,
                buttonLabel: 'Export',
                filters: [
                    { name: 'PNG', extensions: [ 'png' ] },
                    { name: 'SVG', extensions: [ 'svg' ] }
                ]
            };
            const selectedFile = electron.dialog.showSaveDialogSync(owner, showSaveDialogOptions);
            if (selectedFile) {
                view.execute('export', { 'file': selectedFile });
            }
        }
    }

    service(name) {
        if (name == 'configuration') {
            return this._configuration;
        }
        return undefined;
    }

    execute(command, data) {
        const view = this._views.activeView;
        if (view) {
            view.execute(command, data || {});
        }
        this._updateMenu();
    }

    _reload() {
        const view = this._views.activeView;
        if (view && view.path) {
            this._loadPath(view.path, view);
        }
    }

    _checkForUpdates() {
        if (!electron.app.isPackaged) {
            return;
        }
        const autoUpdater = updater.autoUpdater;
        if (autoUpdater.app && autoUpdater.app.appUpdateConfigPath && !fs.existsSync(autoUpdater.app.appUpdateConfigPath)) {
            return;
        }
        const promise = autoUpdater.checkForUpdates();
        if (promise) {
            promise.catch((error) => {
                console.log(error.message);
            });
        }
    }

    get package() {
        if (!this._package) {
            const file = path.join(path.dirname(__dirname), 'package.json');
            const data = fs.readFileSync(file);
            this._package = JSON.parse(data);
            this._package.date = new Date(fs.statSync(file).mtime);
        }
        return this._package;
    }

    _about() {
        let dialog = null;
        const options = {
            show: false,
            backgroundColor: electron.nativeTheme.shouldUseDarkColors ? '#2d2d2d' : '#e6e6e6',
            width: 400,
            height: 250,
            center: true,
            minimizable: false,
            maximizable: false,
            useContentSize: true,
            resizable: true,
            fullscreenable: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: true,
            }
        };
        if (process.platform === 'darwin') {
            options.title = '';
            dialog = Application._aboutDialog;
        }
        else {
            options.title = 'About ' + electron.app.name;
            options.parent = electron.BrowserWindow.getFocusedWindow();
            options.modal = true;
            options.showInTaskbar = false;
        }
        if (process.platform === 'win32') {
            options.type = 'toolbar';
        }
        if (!dialog) {
            dialog = new electron.BrowserWindow(options);
            if (process.platform === 'darwin') {
                Application._aboutDialog = dialog;
            }
            dialog.removeMenu();
            dialog.excludedFromShownWindowsMenu = true;
            dialog.webContents.on('new-window', (event, url) => {
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    event.preventDefault();
                    electron.shell.openExternal(url);
                }
            });
            let content = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
            content = content.replace('{version}', this.package.version);
            content = content.replace('<title>Netron</title>', '');
            content = content.replace('<body class="welcome spinner">', '<body class="about desktop">');
            content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
            content = content.replace(/<link.*>/gi, '');
            dialog.once('ready-to-show', () => {
                dialog.resizable = false;
                dialog.show();
            });
            dialog.on('close', function() {
                electron.globalShortcut.unregister('Escape');
                Application._aboutDialog = null;
            });
            dialog.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(content));
            electron.globalShortcut.register('Escape', function() {
                dialog.close();
            });
        }
        else {
            dialog.show();
        }
    }

    _updateMenu() {
        const window = electron.BrowserWindow.getFocusedWindow();
        this._menu.update({
            window: window,
            webContents: window ? window.webContents : null,
            view: this._views.activeView
        }, this._views.views.map((view) => view.window));
    }

    _resetMenu() {
        const menuRecentsTemplate = [];
        if (this._configuration.has('recents')) {
            let recents = this._configuration.get('recents');
            recents = recents.filter((recent) => {
                const path = recent.path;
                if (fs.existsSync(path)) {
                    const stat = fs.statSync(path);
                    if (stat.isFile() || stat.isDirectory()) {
                        return true;
                    }
                }
                return false;
            });
            if (recents.length > 9) {
                recents.splice(9);
            }
            this._configuration.set('recents', recents);
            for (let i = 0; i < recents.length; i++) {
                const recent = recents[i];
                menuRecentsTemplate.push({
                    path: recent.path,
                    label: Application.minimizePath(recent.path),
                    accelerator: ((process.platform === 'darwin') ? 'Cmd+' : 'Ctrl+') + (i + 1).toString(),
                    click: (item) => { this._openPath(item.path); }
                });
            }
        }

        const menuTemplate = [];

        if (process.platform === 'darwin') {
            menuTemplate.unshift({
                label: electron.app.name,
                submenu: [
                    {
                        label: 'About ' + electron.app.name,
                        click: () => this._about()
                    },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideothers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' }
                ]
            });
        }

        menuTemplate.push({
            label: '&File',
            submenu: [
                {
                    label: '&Open...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => { this._openFileDialog(); }
                },
                {
                    label: 'Open &Recent',
                    submenu: menuRecentsTemplate
                },
                { type: 'separator' },
                {
                    id: 'file.export',
                    label: '&Export...',
                    accelerator: 'CmdOrCtrl+Shift+E',
                    click: () => this._export(),
                },
                { type: 'separator' },
                { role: 'close' },
            ]
        });

        if (process.platform !== 'darwin') {
            menuTemplate.slice(-1)[0].submenu.push(
                { type: 'separator' },
                { role: 'quit' }
            );
        }

        if (process.platform == 'darwin') {
            electron.systemPreferences.setUserDefault('NSDisabledDictationMenuItem', 'boolean', true);
            electron.systemPreferences.setUserDefault('NSDisabledCharacterPaletteMenuItem', 'boolean', true);
        }

        menuTemplate.push({
            label: '&Edit',
            submenu: [
                {
                    id: 'edit.cut',
                    label: 'Cu&t',
                    accelerator: 'CmdOrCtrl+X',
                    click: () => this.execute('cut', null),
                },
                {
                    id: 'edit.copy',
                    label: '&Copy',
                    accelerator: 'CmdOrCtrl+C',
                    click: () => this.execute('copy', null),
                },
                {
                    id: 'edit.paste',
                    label: '&Paste',
                    accelerator: 'CmdOrCtrl+V',
                    click: () => this.execute('paste', null),
                },
                {
                    id: 'edit.select-all',
                    label: 'Select &All',
                    accelerator: 'CmdOrCtrl+A',
                    click: () => this.execute('selectall', null),
                },
                { type: 'separator' },
                {
                    id: 'edit.find',
                    label: '&Find...',
                    accelerator: 'CmdOrCtrl+F',
                    click: () => this.execute('find', null),
                }
            ]
        });

        const viewTemplate = {
            label: '&View',
            submenu: [
                {
                    id: 'view.show-attributes',
                    accelerator: 'CmdOrCtrl+D',
                    click: () => this.execute('toggle-attributes', null),
                },
                {
                    id: 'view.show-initializers',
                    accelerator: 'CmdOrCtrl+I',
                    click: () => this.execute('toggle-initializers', null),
                },
                {
                    id: 'view.show-names',
                    accelerator: 'CmdOrCtrl+U',
                    click: () => this.execute('toggle-names', null),
                },
                {
                    id: 'view.show-horizontal',
                    accelerator: 'CmdOrCtrl+K',
                    click: () => this.execute('toggle-direction', null),
                },
                { type: 'separator' },
                {
                    id: 'view.reload',
                    label: '&Reload',
                    accelerator: (process.platform === 'darwin') ? 'Cmd+R' : 'F5',
                    click: () => this._reload(),
                },
                { type: 'separator' },
                {
                    id: 'view.reset-zoom',
                    label: 'Actual &Size',
                    accelerator: 'Shift+Backspace',
                    click: () => this.execute('reset-zoom', null),
                },
                {
                    id: 'view.zoom-in',
                    label: 'Zoom &In',
                    accelerator: 'Shift+Up',
                    click: () => this.execute('zoom-in', null),
                },
                {
                    id: 'view.zoom-out',
                    label: 'Zoom &Out',
                    accelerator: 'Shift+Down',
                    click: () => this.execute('zoom-out', null),
                },
                { type: 'separator' },
                {
                    id: 'view.show-properties',
                    label: '&Properties...',
                    accelerator: 'CmdOrCtrl+Enter',
                    click: () => this.execute('show-properties', null),
                }
            ]
        };
        if (!electron.app.isPackaged) {
            viewTemplate.submenu.push({ type: 'separator' });
            viewTemplate.submenu.push({ role: 'toggledevtools' });
        }
        menuTemplate.push(viewTemplate);

        if (process.platform === 'darwin') {
            menuTemplate.push({
                role: 'window',
                submenu: [
                    { role: 'minimize' },
                    { role: 'zoom' },
                    { type: 'separator' },
                    { role: 'front'}
                ]
            });
        }

        const helpSubmenu = [
            {
                label: '&Search Feature Requests',
                click: () => { electron.shell.openExternal('https://www.github.com/' + this.package.repository + '/issues'); }
            },
            {
                label: 'Report &Issues',
                click: () => { electron.shell.openExternal('https://www.github.com/' + this.package.repository + '/issues/new'); }
            }
        ];

        if (process.platform != 'darwin') {
            helpSubmenu.push({ type: 'separator' });
            helpSubmenu.push({
                label: 'About ' + electron.app.name,
                click: () => this._about()
            });
        }

        menuTemplate.push({
            role: 'help',
            submenu: helpSubmenu
        });

        const commandTable = new Map();
        commandTable.set('file.export', {
            enabled: (context) => { return context.view && context.view.path ? true : false; }
        });
        commandTable.set('edit.cut', {
            enabled: (context) => { return context.view && context.view.path ? true : false; }
        });
        commandTable.set('edit.copy', {
            enabled: (context) => { return context.view && context.view.path ? true : false; }
        });
        commandTable.set('edit.paste', {
            enabled: (context) => { return context.view && context.view.path ? true : false; }
        });
        commandTable.set('edit.select-all', {
            enabled: (context) => { return context.view && context.view.path ? true : false; }
        });
        commandTable.set('edit.find', {
            enabled: (context) => { return context.view && context.view.path ? true : false; }
        });
        commandTable.set('view.show-attributes', {
            enabled: (context) => { return context.view && context.view.path ? true : false; },
            label: (context) => { return !context.view || !context.view.get('show-attributes') ? 'Show &Attributes' : 'Hide &Attributes'; }
        });
        commandTable.set('view.show-initializers', {
            enabled: (context) => { return context.view && context.view.path ? true : false; },
            label: (context) => { return !context.view || !context.view.get('show-initializers') ? 'Show &Initializers' : 'Hide &Initializers'; }
        });
        commandTable.set('view.show-names', {
            enabled: (context) => { return context.view && context.view.path ? true : false; },
            label: (context) => { return !context.view || !context.view.get('show-names') ? 'Show &Names' : 'Hide &Names'; }
        });
        commandTable.set('view.show-horizontal', {
            enabled: (context) => { return context.view && context.view.path ? true : false; },
            label: (context) => { return !context.view || !context.view.get('show-horizontal') ? 'Show &Horizontal' : 'Show &Vertical'; }
        });
        commandTable.set('view.reload', {
            enabled: (context) => { return context.view && context.view.path ? true : false; }
        });
        commandTable.set('view.reset-zoom', {
            enabled: (context) => { return context.view && context.view.path ? true : false; }
        });
        commandTable.set('view.zoom-in', {
            enabled: (context) => { return context.view && context.view.path ? true : false; }
        });
        commandTable.set('view.zoom-out', {
            enabled: (context) => { return context.view && context.view.path ? true : false; }
        });
        commandTable.set('view.show-properties', {
            enabled: (context) => { return context.view && context.view.path ? true : false; }
        });

        this._menu.build(menuTemplate, commandTable, this._views.views.map((view) => view.window));
        this._updateMenu();
    }

    static minimizePath(file) {
        if (process.platform != 'win32') {
            const homeDir = os.homedir();
            if (file.startsWith(homeDir)) {
                return '~' + file.substring(homeDir.length);
            }
        }
        return file;
    }

}

class View {

    constructor(owner) {
        this._owner = owner;
        this._ready = false;
        this._path = null;
        this._properties = new Map();
        this._location = url.format({ protocol: 'file:', slashes: true, pathname: path.join(__dirname, 'electron.html') });

        const size = electron.screen.getPrimaryDisplay().workAreaSize;
        const options = {
            show: false,
            title: electron.app.name,
            backgroundColor: electron.nativeTheme.shouldUseDarkColors ? '#1d1d1d' : '#e6e6e6',
            icon: electron.nativeImage.createFromPath(path.join(__dirname, 'icon.png')),
            minWidth: 600,
            minHeight: 400,
            width: size.width > 1024 ? 1024 : size.width,
            height: size.height > 768 ? 768 : size.height,
            webPreferences: {
                preload: path.join(__dirname, 'electron.js'),
                nodeIntegration: true,
                contextIsolation: true
            }
        };
        if (this._owner.count > 0 && View._position && View._position.length == 2) {
            options.x = View._position[0] + 30;
            options.y = View._position[1] + 30;
            if (options.x + options.width > size.width) {
                options.x = 0;
            }
            if (options.y + options.height > size.height) {
                options.y = 0;
            }
        }
        this._window = new electron.BrowserWindow(options);
        View._position = this._window.getPosition();
        this._updateCallback = (event, data) => {
            if (event.sender == this._window.webContents) {
                this.update(data.name, data.value);
                this._raise('updated');
            }
        };
        electron.ipcMain.on('update', this._updateCallback);
        this._window.on('closed', () => {
            electron.ipcMain.removeListener('update', this._updateCallback);
            this._owner.closeView(this);
        });
        this._window.on('focus', () => {
            this._raise('activated');
        });
        this._window.on('blur', () => {
            this._raise('deactivated');
        });
        this._window.webContents.on('did-finish-load', () => {
            this._didFinishLoad = true;
        });
        this._window.webContents.on('new-window', (event, url) => {
            if (url.startsWith('http://') || url.startsWith('https://')) {
                event.preventDefault();
                electron.shell.openExternal(url);
            }
        });
        this._window.once('ready-to-show', () => {
            this._window.show();
        });
        this._window.loadURL(this._location);
    }

    get window() {
        return this._window;
    }

    get path() {
        return this._path;
    }

    open(path) {
        this._openPath = path;
        if (this._didFinishLoad) {
            this._window.webContents.send('open', { path: path });
        }
        else {
            this._window.webContents.on('did-finish-load', () => {
                this._window.webContents.send('open', { path: path });
            });
            this._window.loadURL(this._location);
        }
    }

    restore() {
        if (this._window) {
            if (this._window.isMinimized()) {
                this._window.restore();
            }
            this._window.show();
        }
    }

    match(path) {
        if (this._openPath) {
            if (path === null) {
                return false;
            }
            if (path === this._openPath) {
                return true;
            }
        }
        return this._path == path;
    }

    execute(command, data) {
        if (this._window && this._window.webContents) {
            this._window.webContents.send(command, data);
        }
    }

    update(name, value) {
        if (name === 'path') {
            if (value) {
                this._path = value;
                const title = Application.minimizePath(this._path);
                this._window.setTitle(process.platform !== 'darwin' ? title + ' - ' + electron.app.name : title);
                this._window.focus();
            }
            this._openPath = null;
            return;
        }
        this._properties.set(name, value);
    }

    get(name) {
        return this._properties.get(name);
    }

    on(event, callback) {
        this._events = this._events || {};
        this._events[event] = this._events[event] || [];
        this._events[event].push(callback);
    }

    _raise(event, data) {
        if (this._events && this._events[event]) {
            for (const callback of this._events[event]) {
                callback(this, data);
            }
        }
    }
}

class ViewCollection {

    constructor() {
        this._views = [];
    }

    get views() {
        return this._views;
    }

    get count() {
        return this._views.length;
    }

    item(index) {
        return this._views[index];
    }

    openView() {
        const view = new View(this);
        view.on('activated', (sender) => {
            this._activeView = sender;
            this._raise('active-view-changed', { activeView: this._activeView });
        });
        view.on('updated', () => {
            this._raise('active-view-updated', { activeView: this._activeView });
        });
        view.on('deactivated', () => {
            this._activeView = null;
            this._raise('active-view-changed', { activeView: this._activeView });
        });
        this._views.push(view);
        this._updateActiveView();
        return view;
    }

    closeView(view) {
        for (let i = this._views.length - 1; i >= 0; i--) {
            if (this._views[i] == view) {
                this._views.splice(i, 1);
            }
        }
        this._updateActiveView();
    }

    find(path) {
        return this._views.find(view => view.match(path));
    }

    from(contents) {
        return this._views.find(view => view && view.window && view.window.webContents && view.window.webContents == contents);
    }

    get activeView() {
        return this._activeView;
    }

    on(event, callback) {
        this._events = this._events || {};
        this._events[event] = this._events[event] || [];
        this._events[event].push(callback);
    }

    _raise(event, data) {
        if (this._events && this._events[event]) {
            for (const callback of this._events[event]) {
                callback(this, data);
            }
        }
    }

    _updateActiveView() {
        const window = electron.BrowserWindow.getFocusedWindow();
        const view = this._views.find(view => view.window == window) || null;
        if (view != this._activeView) {
            this._activeView = view;
            this._raise('active-view-changed', { activeView: this._activeView });
        }
    }
}

class ConfigurationService {

    load() {
        this._data = { 'recents': [] };
        const dir = electron.app.getPath('userData');
        if (dir && dir.length > 0) {
            const file = path.join(dir, 'configuration.json');
            if (fs.existsSync(file)) {
                const data = fs.readFileSync(file);
                if (data) {
                    try {
                        this._data = JSON.parse(data);
                    }
                    catch (error) {
                        // continue regardless of error
                    }
                }
            }
        }
    }

    save() {
        if (this._data) {
            const data = JSON.stringify(this._data, null, 2);
            if (data) {
                const dir = electron.app.getPath('userData');
                if (dir && dir.length > 0) {
                    const file = path.join(dir, 'configuration.json');
                    fs.writeFileSync(file, data);
                }
            }
        }
    }

    has(name) {
        return this._data && Object.prototype.hasOwnProperty.call(this._data, name);
    }

    set(name, value) {
        this._data[name] = value;
    }

    get(name) {
        return this._data[name];
    }

}

class MenuService {

    build(menuTemplate, commandTable, windows) {
        this._menuTemplate = menuTemplate;
        this._commandTable = commandTable;
        this._itemTable = new Map();
        for (const menu of menuTemplate) {
            for (const item of menu.submenu) {
                if (item.id) {
                    if (!item.label) {
                        item.label = '';
                    }
                    this._itemTable.set(item.id, item);
                }
            }
        }
        this._rebuild(windows);
    }

    update(context, windows) {
        if (!this._menu && !this._commandTable) {
            return;
        }
        if (this._updateLabel(context)) {
            this._rebuild(windows);
        }
        this._updateEnabled(context);
    }

    _rebuild(windows) {
        this._menu = electron.Menu.buildFromTemplate(this._menuTemplate);
        if (process.platform === 'darwin') {
            electron.Menu.setApplicationMenu(this._menu);
        }
        else {
            for (const window of windows) {
                window.setMenu(this._menu);
            }
        }
    }

    _updateLabel(context) {
        let rebuild = false;
        for (const entry of this._commandTable.entries()) {
            const menuItem = this._menu.getMenuItemById(entry[0]);
            const command = entry[1];
            if (command && command.label) {
                const label = command.label(context);
                if (label != menuItem.label) {
                    if (this._itemTable.has(entry[0])) {
                        this._itemTable.get(entry[0]).label = label;
                        rebuild = true;
                    }
                }
            }
        }
        return rebuild;
    }

    _updateEnabled(context) {
        for (const entry of this._commandTable.entries()) {
            const menuItem = this._menu.getMenuItemById(entry[0]);
            if (menuItem) {
                const command = entry[1];
                if (command.enabled) {
                    menuItem.enabled = command.enabled(context);
                }
            }
        }
    }
}

global.application = new Application();
