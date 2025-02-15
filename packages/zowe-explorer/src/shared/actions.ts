/*
 * This program and the accompanying materials are made available under the terms of the *
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at *
 * https://www.eclipse.org/legal/epl-v20.html                                      *
 *                                                                                 *
 * SPDX-License-Identifier: EPL-2.0                                                *
 *                                                                                 *
 * Copyright Contributors to the Zowe Project.                                     *
 *                                                                                 *
 */

import * as vscode from "vscode";
import * as globals from "../globals";
import { openPS } from "../dataset/actions";
import { IZoweDatasetTreeNode, IZoweUSSTreeNode, IZoweNodeType, IZoweTree } from "@zowe/zowe-explorer-api";
import { Profiles } from "../Profiles";
import { filterTreeByString } from "../shared/utils";
import { FilterItem, resolveQuickPickHelper, FilterDescriptor } from "../utils/ProfilesUtils";
import * as contextually from "../shared/context";
import * as nls from "vscode-nls";
import { getIconById, IconId } from "../generators/icons";

// Set up localization
nls.config({
    messageFormat: nls.MessageFormat.bundle,
    bundleFormat: nls.BundleFormat.standalone,
})();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

/**
 * Search for matching items loaded in data set or USS tree
 *
 */
export async function searchInAllLoadedItems(
    datasetProvider?: IZoweTree<IZoweDatasetTreeNode>,
    ussFileProvider?: IZoweTree<IZoweUSSTreeNode>
) {
    let pattern: string;
    const items: IZoweNodeType[] = [];
    const qpItems = [];
    const quickpick = vscode.window.createQuickPick();
    quickpick.placeholder = localize("searchHistory.options.prompt", "Enter a filter");
    quickpick.ignoreFocusOut = true;
    quickpick.onDidChangeValue(async (value) => {
        if (value) {
            quickpick.items = filterTreeByString(value, qpItems);
        } else {
            quickpick.items = [...qpItems];
        }
    });

    // Get loaded items from Tree Providers
    if (datasetProvider) {
        const newItems = await datasetProvider.getAllLoadedItems();
        items.push(...newItems);
    }
    if (ussFileProvider) {
        const newItems = await ussFileProvider.getAllLoadedItems();
        items.push(...newItems);
    }

    if (items.length === 0) {
        vscode.window.showInformationMessage(
            localize("searchInAllLoadedItems.noneLoaded", "No items are loaded in the tree.")
        );
        return;
    }

    let qpItem: vscode.QuickPickItem;
    for (const item of items) {
        if (contextually.isDs(item) || contextually.isPdsNotFav(item) || contextually.isVsam(item)) {
            if (contextually.isDsMember(item)) {
                qpItem = new FilterItem({
                    text: `[${item.getSessionNode().label.toString()}]: ${item
                        .getParent()
                        .label.toString()}(${item.label.toString()})`,
                    description: "Data Set Member",
                });
            } else {
                qpItem = new FilterItem({
                    text: `[${item.getSessionNode().label.toString()}]: ${item.label.toString()}`,
                    description: "Data Set",
                });
            }
            qpItems.push(qpItem);
        } else if (contextually.isUssDirectory(item) || contextually.isText(item) || contextually.isBinary(item)) {
            const filterItem = `[${item.getProfileName().trim()}]: ${
                item.getParent().fullPath
            }/${item.label.toString()}`;
            qpItem = new FilterItem({ text: filterItem, description: "USS" });
            qpItems.push(qpItem);
        }
    }
    quickpick.items = [...qpItems];

    quickpick.show();
    const choice = await resolveQuickPickHelper(quickpick);
    if (!choice) {
        vscode.window.showInformationMessage(
            localize("searchInAllLoadedItems.enterPattern", "You must enter a pattern.")
        );
        return;
    } else {
        pattern = choice.label;
    }
    quickpick.dispose();

    if (pattern) {
        // Parse pattern for item name
        let filePath: string;
        let nodeName: string;
        let memberName: string;
        const sessionName = pattern.substring(1, pattern.indexOf("]"));
        if (pattern.indexOf("(") !== -1) {
            nodeName = pattern.substring(pattern.indexOf(" ") + 1, pattern.indexOf("("));
            memberName = pattern.substring(pattern.indexOf("(") + 1, pattern.indexOf(")"));
        } else if (pattern.indexOf("/") !== -1) {
            filePath = pattern.substring(pattern.indexOf(" ") + 1);
        } else {
            nodeName = pattern.substring(pattern.indexOf(" ") + 1);
        }

        // Find & reveal nodes in tree
        if (pattern.indexOf("/") !== -1) {
            // USS nodes
            const node = items.filter((item) => item.fullPath.trim() === filePath)[0];
            ussFileProvider.setItem(ussFileProvider.getTreeView(), node);

            if (node.contextValue !== globals.USS_DIR_CONTEXT) {
                // If selected item is file, open it in workspace
                ussFileProvider.addSearchHistory(node.fullPath);
                const ussNode: IZoweUSSTreeNode = node;
                ussNode.openUSS(false, true, ussFileProvider);
            }
        } else {
            // Data set nodes
            const sessions = await datasetProvider.getChildren();
            const sessionNode = sessions.filter((session) => session.label.toString() === sessionName)[0];
            let children = await datasetProvider.getChildren(sessionNode);
            const node = children.filter((child) => child.label.toString() === nodeName)[0];

            if (memberName) {
                // Members
                children = await datasetProvider.getChildren(node);
                const member = children.filter((child) => child.label.toString() === memberName)[0];
                node.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                await datasetProvider.getTreeView().reveal(member, { select: true, focus: true, expand: false });

                // Open in workspace
                datasetProvider.addSearchHistory(`${nodeName}(${memberName})`);
                openPS(member, true, datasetProvider);
            } else {
                // PDS & SDS
                await datasetProvider.getTreeView().reveal(node, { select: true, focus: true, expand: false });

                // If selected node was SDS, open it in workspace
                if (contextually.isDs(node)) {
                    datasetProvider.addSearchHistory(nodeName);
                    openPS(node, true, datasetProvider);
                }
            }
        }
    }
}

export async function openRecentMemberPrompt(
    datasetTree: IZoweTree<IZoweDatasetTreeNode>,
    ussTree: IZoweTree<IZoweUSSTreeNode>
) {
    if (globals.LOG) {
        globals.LOG.debug(
            localize("enterPattern.log.debug.prompt", "Prompting the user to choose a recent member for editing")
        );
    }
    let pattern: string;

    const fileHistory = [...datasetTree.getFileHistory(), ...ussTree.getFileHistory()];

    // Get user selection
    if (fileHistory.length > 0) {
        const createPick = new FilterDescriptor(
            localize("memberHistory.option.prompt.open", "Select a recent member to open")
        );
        const items: vscode.QuickPickItem[] = fileHistory.map((element) => new FilterItem({ text: element }));
        if (globals.ISTHEIA) {
            const options1: vscode.QuickPickOptions = {
                placeHolder: localize("memberHistory.options.prompt", "Select a recent member to open"),
            };

            const choice = await vscode.window.showQuickPick([createPick, ...items], options1);
            if (!choice) {
                vscode.window.showInformationMessage(
                    localize("enterPattern.pattern", "No selection made. Operation cancelled.")
                );
                return;
            }
            pattern = choice === createPick ? "" : choice.label;
        } else {
            const quickpick = vscode.window.createQuickPick();
            quickpick.items = [createPick, ...items];
            quickpick.placeholder = localize("memberHistory.options.prompt", "Select a recent member to open");
            quickpick.ignoreFocusOut = true;
            quickpick.show();
            const choice = await resolveQuickPickHelper(quickpick);
            quickpick.hide();
            if (!choice || choice === createPick) {
                vscode.window.showInformationMessage(
                    localize("enterPattern.pattern", "No selection made. Operation cancelled.")
                );
                return;
            } else if (choice instanceof FilterDescriptor) {
                pattern = quickpick.value;
            } else {
                pattern = choice.label;
            }
        }

        const sessionName = pattern.substring(1, pattern.indexOf("]")).trim();

        if (pattern.indexOf("/") > -1) {
            // USS file was selected
            const filePath = pattern.substring(pattern.indexOf("/"));
            const sessionNode: IZoweUSSTreeNode = ussTree.mSessionNodes.find(
                (sessNode) => sessNode.getProfileName() === sessionName
            );
            await ussTree.openItemFromPath(filePath, sessionNode);
        } else {
            // Data set was selected
            const sessionNode: IZoweDatasetTreeNode = datasetTree.mSessionNodes.find(
                (sessNode) => sessNode.label.toString().toLowerCase() === sessionName.toLowerCase()
            );
            await datasetTree.openItemFromPath(pattern, sessionNode);
        }
    } else {
        vscode.window.showInformationMessage(localize("getRecentMembers.empty", "No recent members found."));
        return;
    }
}

export async function returnIconState(node: IZoweNodeType) {
    const activePathClosed = getIconById(IconId.sessionActive);
    const activePathOpen = getIconById(IconId.sessionActiveOpen);
    const inactivePathClosed = getIconById(IconId.sessionInactive); // So far, we only ever reference the closed inactive icon, not the open one
    if (
        node.iconPath === activePathClosed.path ||
        node.iconPath === activePathOpen.path ||
        node.iconPath === inactivePathClosed.path
    ) {
        const sessionIcon = getIconById(IconId.session);
        if (sessionIcon) {
            node.iconPath = sessionIcon.path;
        }
    }
    return node;
}

export async function resetValidationSettings(node: IZoweNodeType, setting: boolean) {
    if (setting) {
        await Profiles.getInstance().enableValidationContext(node);
        // Ensure validation status is also reset
        node.contextValue = node.contextValue.replace(/(_Active)/g, "").replace(/(_Inactive)/g, "");
    } else {
        await Profiles.getInstance().disableValidationContext(node);
    }
    return node;
}
