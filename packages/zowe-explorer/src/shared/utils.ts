/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

// Generic utility functions related to all node types. See ./src/utils.ts for other utility functions.

import * as vscode from "vscode";
import * as path from "path";
import * as globals from "../globals";
import { IZoweTreeNode, Types, IZoweDatasetTreeNode, IZoweUSSTreeNode, IZoweJobTreeNode, IZoweTree } from "@zowe/zowe-explorer-api";
import { ZoweLogger } from "../utils/LoggerUtils";

export enum JobSubmitDialogOpts {
    Disabled,
    YourJobs,
    OtherUserJobs,
    AllJobs,
}
export const JOB_SUBMIT_DIALOG_OPTS = [
    vscode.l10n.t("Disabled"),
    vscode.l10n.t("Your jobs"),
    vscode.l10n.t("Other user jobs"),
    vscode.l10n.t("All jobs"),
];

export const SORT_DIRS: string[] = [vscode.l10n.t("Ascending"), vscode.l10n.t("Descending")];

export type LocalFileInfo = {
    name: string;
    path: string;
};

export function filterTreeByString(value: string, treeItems: vscode.QuickPickItem[]): vscode.QuickPickItem[] {
    ZoweLogger.trace("shared.utils.filterTreeByString called.");
    const filteredArray: vscode.QuickPickItem[] = [];
    value = value.toUpperCase().replace(/\*/g, "(.*)");
    const regex = new RegExp(value);
    treeItems.forEach((item) => {
        if (item.label.toUpperCase().match(regex)) {
            filteredArray.push(item);
        }
    });
    return filteredArray;
}

/**
 * Gets path to the icon, which is located in resources folder
 * @param iconFileName {string} Name of icon file with extension
 * @returns {object}
 */
export function getIconPathInResources(iconFileName: string): {
    light: string;
    dark: string;
} {
    return {
        light: path.join(globals.ROOTPATH, "resources", "light", iconFileName),
        dark: path.join(globals.ROOTPATH, "resources", "dark", iconFileName),
    };
}

/*************************************************************************************************************
 * Returns array of all subnodes of given node
 *************************************************************************************************************/
export function concatChildNodes(nodes: Types.IZoweNodeType[]): Types.IZoweNodeType[] {
    ZoweLogger.trace("shared.utils.concatChildNodes called.");
    let allNodes = new Array<Types.IZoweNodeType>();

    for (const node of nodes) {
        allNodes = allNodes.concat(concatChildNodes(node.children));
        allNodes.push(node);
    }
    return allNodes;
}

export function sortTreeItems(favorites: vscode.TreeItem[], specificContext): void {
    favorites.sort((a, b) => {
        if (a.contextValue === specificContext) {
            if (b.contextValue === specificContext) {
                return a.label.toString().toUpperCase() > b.label.toString().toUpperCase() ? 1 : -1;
            }

            return -1;
        }

        if (b.contextValue === specificContext) {
            return 1;
        }

        return a.label.toString().toUpperCase() > b.label.toString().toUpperCase() ? 1 : -1;
    });
}

/*************************************************************************************************************
 * Determine IDE name to display based on app environment
 *************************************************************************************************************/
export function getAppName(isTheia: boolean): "Theia" | "VS Code" {
    return isTheia ? "Theia" : "VS Code";
}

/**
 * Returns the file path for the IZoweTreeNode
 *
 * @export
 * @param {string} label - If node is a member, label includes the name of the PDS
 * @param {IZoweTreeNode} node
 */
export function getDocumentFilePath(label: string, node: IZoweTreeNode): string {
    const dsDir = globals.DS_DIR;
    const profName = node.getProfileName();
    const suffix = appendSuffix(label);
    return path.join(dsDir, profName || "", suffix);
}

/**
 * Append a suffix on a ds file so it can be interpretted with syntax highlighter
 *
 * Rules of mapping:
 *  1. Start with LLQ and work backwards as it is at this end usually
 *   the language is specified
 *  2. Dont do this for the top level HLQ
 */
function appendSuffix(label: string): string {
    const limit = 5;
    const bracket = label.indexOf("(");
    const split = bracket > -1 ? label.substr(0, bracket).split(".", limit) : label.split(".", limit);
    for (let i = split.length - 1; i > 0; i--) {
        if (["JCL", "JCLLIB", "CNTL"].includes(split[i])) {
            return label.concat(".jcl");
        }
        if (["COBOL", "CBL", "COB", "SCBL"].includes(split[i])) {
            return label.concat(".cbl");
        }
        if (["COPYBOOK", "COPY", "CPY", "COBCOPY"].includes(split[i])) {
            return label.concat(".cpy");
        }
        if (["INC", "INCLUDE", "PLINC"].includes(split[i])) {
            return label.concat(".inc");
        }
        if (["PLI", "PL1", "PLX", "PCX"].includes(split[i])) {
            return label.concat(".pli");
        }
        if (["SH", "SHELL"].includes(split[i])) {
            return label.concat(".sh");
        }
        if (["REXX", "REXEC", "EXEC"].includes(split[i])) {
            return label.concat(".rexx");
        }
        if (split[i] === "XML") {
            return label.concat(".xml");
        }
        if (split[i] === "ASM" || split[i].indexOf("ASSEMBL") > -1) {
            return label.concat(".asm");
        }
        if (split[i] === "LOG" || split[i].indexOf("SPFLOG") > -1) {
            return label.concat(".log");
        }
    }
    return label;
}

export function checkForAddedSuffix(filename: string): boolean {
    // identify how close to the end of the string the last . is
    const dotPos = filename.length - (1 + filename.lastIndexOf("."));
    return (
        dotPos >= 2 &&
        dotPos <= 4 && // if the last characters are 2 to 4 long and lower case it has been added
        filename.substring(filename.length - dotPos) === filename.substring(filename.length - dotPos).toLowerCase()
    );
}

export function checkIfChildPath(parentPath: string, childPath: string): boolean {
    const relativePath = path.relative(parentPath, childPath);
    return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

/**
 * Function that rewrites the document in the active editor thus marking it dirty
 * @param {vscode.TextDocument} doc - document to rewrite
 * @returns void
 */

export function markFileAsDirty(doc: vscode.TextDocument): void {
    const docText = doc.getText();
    const startPosition = new vscode.Position(0, 0);
    const endPosition = new vscode.Position(doc.lineCount, 0);
    const deleteRange = new vscode.Range(startPosition, endPosition);
    vscode.window.activeTextEditor.edit((editBuilder) => {
        editBuilder.delete(deleteRange);
        editBuilder.insert(startPosition, docText);
    });
}

// Type guarding for current IZoweNodeType.
// Makes it possible to have multiple types in a function signature, but still be able to use type specific code inside the function definition
export function isZoweDatasetTreeNode(node: Types.IZoweNodeType): node is IZoweDatasetTreeNode {
    return (node as IZoweDatasetTreeNode).pattern !== undefined;
}

export function isZoweUSSTreeNode(node: IZoweDatasetTreeNode | IZoweUSSTreeNode | IZoweJobTreeNode): node is IZoweUSSTreeNode {
    return (node as IZoweUSSTreeNode).openUSS !== undefined;
}

export function isZoweJobTreeNode(node: IZoweDatasetTreeNode | IZoweUSSTreeNode | IZoweJobTreeNode): node is IZoweJobTreeNode {
    return (node as IZoweJobTreeNode).job !== undefined;
}

export function getSelectedNodeList(node: IZoweTreeNode, nodeList: IZoweTreeNode[]): IZoweTreeNode[] {
    let resultNodeList: IZoweTreeNode[] = [];
    if (!nodeList) {
        resultNodeList.push(node);
    } else {
        resultNodeList = nodeList;
    }
    return resultNodeList;
}

/**
 * Function that validates job prefix
 * @param {string} text - prefix text
 * @returns undefined | string
 */
export function jobStringValidator(text: string, localizedParam: "owner" | "prefix"): string | null {
    switch (localizedParam) {
        case "owner":
            return text.length > globals.JOBS_MAX_PREFIX ? vscode.l10n.t("Invalid job owner") : null;
        case "prefix":
        default:
            return text.length > globals.JOBS_MAX_PREFIX ? vscode.l10n.t("Invalid job prefix") : null;
    }
}

export function updateOpenFiles<T extends IZoweTreeNode>(treeProvider: IZoweTree<T>, docPath: string, value: T | null): void {
    if (treeProvider.openFiles) {
        treeProvider.openFiles[docPath] = value;
    }
}
