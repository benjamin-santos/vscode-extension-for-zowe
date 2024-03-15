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

import * as vscode from "vscode";
import * as meta from "../../package.json";
import { ZoweLogger } from "./ZoweLogger";
import { PersistenceSchemaEnum } from "@zowe/zowe-explorer-api";

export enum LocalStorageKey {
    CLI_LOGGER_SETTING_PRESENTED = "zowe.cliLoggerSetting.presented",
    ENCODING_HISTORY = "zowe.encodingHistory",
    LOGGER = "zowe.logger",
    SETTINGS_LOCAL_STORAGE_MIGRATED = "zowe.settings.localStorageMigrated",
    SETTINGS_OLD_SETTINGS_MIGRATED = "zowe.settings.oldSettingsMigrated",
}

export class ZoweLocalStorage {
    private static storage: vscode.Memento;
    public static initializeZoweLocalStorage(state: vscode.Memento): void {
        ZoweLocalStorage.storage = state;
    }

    public static getValue<T>(key: LocalStorageKey | PersistenceSchemaEnum): T {
        ZoweLogger.trace("ZoweLocalStorage.getValue called.");
        const defaultValue = meta.contributes.configuration.properties[key]?.default;
        return ZoweLocalStorage.storage.get<T>(key, defaultValue);
    }

    public static setValue<T>(key: LocalStorageKey | PersistenceSchemaEnum, value: T): void {
        ZoweLogger.trace("ZoweLocalStorage.setValue called.");
        ZoweLocalStorage.storage.update(key, value);
    }
}
