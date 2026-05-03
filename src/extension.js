// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { FileSelectorProvider } from "./fileSelector.js";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
export function activate(context) {
    console.log('Congratulations, your extension "verba" is now active!');
    vscode.window.registerTreeDataProvider(
        "verba.fileSelector",
        new FileSelectorProvider(),
    );
}

// This method is called when your extension is deactivated
export function deactivate() {}
