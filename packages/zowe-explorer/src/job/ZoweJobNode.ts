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

// @ts-nocheck
import * as vscode from "vscode";
import * as zowe from "@zowe/cli";
import * as globals from "../globals";
import * as contextually from "../shared/context";
import { Gui, IZoweJobTreeNode, Sorting, ZoweTreeNode } from "@zowe/zowe-explorer-api";
import { ZoweExplorerApiRegister } from "../ZoweExplorerApiRegister";
import { errorHandling, fallbackProfileName, syncSessionNode } from "../utils/ProfilesUtils";
import { getIconByNode } from "../generators/icons";
import { JOB_SORT_KEYS } from "./utils";
import { Profiles } from "../Profiles";
import { ZoweLogger } from "../utils/LoggerUtils";
import { buildUniqueSpoolName } from "../SpoolProvider";
import { JobFSProvider } from "./JobFSProvider";

export class Job extends ZoweTreeNode implements IZoweJobTreeNode {
    public static readonly JobId = "Job ID: ";
    public static readonly Owner = "Owner: ";
    public static readonly Prefix = "Prefix: ";
    public static readonly Status = "Status: ";

    public resourceUri?: vscode.Uri;

    public children: IZoweJobTreeNode[] = [];
    public dirty = true;
    public sort: NodeSort;
    private _owner: string;
    private _prefix: string;
    private _searchId: string;
    private _jobStatus: string;
    private _tooltip: string;

    public constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        mParent: IZoweJobTreeNode,
        session: zowe.imperative.Session,
        public job: zowe.IJob,
        profile: zowe.imperative.IProfileLoaded
    ) {
        let finalLabel = label;
        // If the node has a parent and the parent is favorited, it is a saved query
        if (mParent != null && contextually.isFavProfile(mParent) && !label.includes("|")) {
            finalLabel = "";
            // Convert old format to new format
            const opts = label.split(" ");
            for (let i = 0; i < opts.length; i++) {
                const opt = opts[i];
                const [key, val] = opt.split(":");
                finalLabel += `${key}: ${val}`;
                if (i != opts.length - 1) {
                    finalLabel += " | ";
                }
            }
        }
        super(finalLabel, collapsibleState, mParent, session, profile);
        this._prefix = "*";
        this._searchId = "";
        this._jobStatus = "*";
        this.filtered = false;

        const isFavorites = label === "Favorites";
        const profileName = profile?.name ?? fallbackProfileName();

        if (mParent == null && !isFavorites) {
            this.contextValue = globals.JOBS_SESSION_CONTEXT;
            this.resourceUri = vscode.Uri.from({
                scheme: "zowe-jobs",
                path: `/${profileName}/`,
            });
            JobFSProvider.instance.createDirectory(this.resourceUri, { isFilter: true });
        }

        if (session) {
            this._owner = "*";
            if (session.ISession?.user) {
                this._owner = session.ISession.user;
            }
        }

        const icon = getIconByNode(this);
        if (icon) {
            this.iconPath = icon.path;
        }

        if (contextually.isSession(this)) {
            this.sort = {
                method: Sorting.JobSortOpts.Id,
                direction: Sorting.SortDirection.Ascending,
            };
            if (!globals.ISTHEIA) {
                this.id = this.label as string;
            }
        } else if (!isFavorites && profile != null) {
            this.resourceUri = vscode.Uri.from({
                scheme: "zowe-jobs",
                path: `/${profileName}/${this.job.jobid}`,
            });
        }
    }

    /**
     * Retrieves child nodes of this IZoweJobTreeNode
     *
     * @returns {Promise<IZoweJobTreeNode[]>}
     */
    public async getChildren(): Promise<IZoweJobTreeNode[]> {
        const thisSessionNode = this.getSessionNode();
        ZoweLogger.trace(`ZoweJobNode.getChildren called for ${String(thisSessionNode.label)}.`);
        if (this?.filter !== undefined) {
            return this.children;
        }
        if (contextually.isSession(this) && !this.filtered && !contextually.isFavorite(this)) {
            const placeholder = new Job(
                vscode.l10n.t("Use the search button to display jobs"),
                vscode.TreeItemCollapsibleState.None,
                this,
                null,
                null,
                null
            );
            placeholder.command = {
                command: "zowe.placeholderCommand",
                title: "Placeholder",
            };
            return [placeholder];
        }

        if (!this.dirty) {
            return this.children;
        }
        const elementChildren: Record<string, ZoweJobNode> = {};
        if (contextually.isJob(this)) {
            // Fetch spool files under job node
            const cachedProfile = Profiles.getInstance().loadNamedProfile(this.getProfileName());
            const spools: zowe.IJobFile[] = (
                (await ZoweExplorerApiRegister.getJesApi(cachedProfile).getSpoolFiles(this.job.jobname, this.job.jobid)) ?? []
            )
                // filter out all the objects which do not seem to be correct Job File Document types
                // see an issue #845 for the details
                .filter((item) => !(item.id === undefined && item.ddname === undefined && item.stepname === undefined));
            if (!spools.length) {
                const noSpoolNode = new Spool(
                    vscode.l10n.t("There are no JES spool messages to display"),
                    vscode.TreeItemCollapsibleState.None,
                    this,
                    null,
                    null,
                    null,
                    this
                );
                noSpoolNode.iconPath = null;
                return [noSpoolNode];
            }
            spools.forEach((spool) => {
                const procstep = spool.procstep ? spool.procstep : undefined;
                let newLabel: string;
                if (procstep) {
                    newLabel = `${spool.stepname}:${spool.ddname} - ${procstep}`;
                } else {
                    newLabel = `${spool.stepname}:${spool.ddname} - ${spool["record-count"]}`;
                }

                // Only look for existing node w/ procstep if spool file has a procstep,
                // otherwise look for only stepname:ddname to update the record count in the label
                const spoolSuffix = procstep ? ` - ${procstep}` : "";
                const existing = this.children.find((element) => element.label?.includes(`${spool.stepname}:${spool.ddname}${spoolSuffix}`));
                if (existing) {
                    existing.label = newLabel;
                    elementChildren[newLabel] = existing;
                } else {
                    const spoolNode = new Spool(newLabel, vscode.TreeItemCollapsibleState.None, this, this.session, spool, this.job, this);
                    JobFSProvider.instance.writeFile(spoolNode.resourceUri, new Uint8Array(), {
                        create: true,
                        overwrite: true,
                        name: spoolNode.uniqueName,
                        spool,
                    });
                    const icon = getIconByNode(spoolNode);
                    if (icon) {
                        spoolNode.iconPath = icon.path;
                    }
                    spoolNode.command = {
                        command: "vscode.open",
                        title: "",
                        arguments: [spoolNode.resourceUri],
                    };
                    elementChildren[newLabel] = spoolNode;
                }
            });
        } else {
            // Fetch jobs under session node
            const jobs = await this.getJobs(this._owner, this._prefix, this._searchId, this._jobStatus);
            if (jobs.length === 0) {
                const noJobsNode = new Job(vscode.l10n.t("No jobs found"), vscode.TreeItemCollapsibleState.None, this, null, null, null);
                noJobsNode.contextValue = globals.INFORMATION_CONTEXT;
                noJobsNode.iconPath = null;
                noJobsNode.command = {
                    command: "zowe.placeholderCommand",
                    title: "Placeholder",
                };
                return [noJobsNode];
            }
            jobs.forEach((job) => {
                let nodeTitle: string;
                if (job.retcode) {
                    nodeTitle = `${job.jobname}(${job.jobid}) - ${job.retcode}`;
                } else {
                    nodeTitle = `${job.jobname}(${job.jobid}) - ${job.status}`;
                }
                // Do not look for status code as it might have changed from previous refresh
                const existing = this.children.find((element) => element.label?.startsWith(`${job.jobname}(${job.jobid})`));
                if (existing) {
                    // If matched, update the label to reflect latest retcode/status
                    existing.label = nodeTitle;
                    elementChildren[nodeTitle] = existing;
                } else {
                    const jobNode = new Job(nodeTitle, vscode.TreeItemCollapsibleState.Collapsed, this, this.session, job, this.getProfile());
                    JobFSProvider.instance.createDirectory(jobNode.resourceUri, { job });

                    jobNode.contextValue = globals.JOBS_JOB_CONTEXT;
                    if (job.retcode) {
                        jobNode.contextValue += globals.RC_SUFFIX + job.retcode;
                    }
                    if (!jobNode.iconPath) {
                        const icon = getIconByNode(jobNode);
                        if (icon) {
                            jobNode.iconPath = icon.path;
                        }
                    }
                    elementChildren[nodeTitle] = jobNode;
                }
            });
        }

        // Only add new children that are not in the list of existing child nodes
        const newChildren = Object.values(elementChildren).filter((c) => this.children.find((ch) => ch.label === c.label) == null);

        const sortMethod = contextually.isSession(this) ? this.sort : { method: Sorting.JobSortOpts.Id, direction: Sorting.SortDirection.Ascending };
        // Remove any children that are no longer present in the built record
        this.children = this.children
            .concat(newChildren)
            .filter((ch) => Object.values(elementChildren).find((recordCh) => recordCh.label === ch.label) != null)
            .sort(Job.sortJobs(sortMethod));
        this.dirty = false;
        return this.children;
    }

    public static sortJobs(sortOpts: Sorting.NodeSort): (x: IZoweJobTreeNode, y: IZoweJobTreeNode) => number {
        return (x, y) => {
            const sortLessThan = sortOpts.direction == Sorting.SortDirection.Ascending ? -1 : 1;
            const sortGreaterThan = sortLessThan * -1;

            const keyToSortBy = JOB_SORT_KEYS[sortOpts.method];
            let xCompare, yCompare;
            if (keyToSortBy === "retcode") {
                // some jobs (such as active ones) will have a null retcode
                // in this case, use status as the key to compare for that node only
                xCompare = x.job["retcode"] ?? x.job["status"];
                yCompare = y.job["retcode"] ?? y.job["status"];
            } else {
                xCompare = x.job[keyToSortBy];
                yCompare = y.job[keyToSortBy];
            }

            if (xCompare === yCompare) {
                return x.job["jobid"] > y.job["jobid"] ? sortGreaterThan : sortLessThan;
            }

            return xCompare > yCompare ? sortGreaterThan : sortLessThan;
        };
    }

    public getSessionNode(): IZoweJobTreeNode {
        ZoweLogger.trace("ZoweJobNode.getSessionNode called.");
        return this.getParent() ? this.getParent().getSessionNode() : this;
    }

    public set tooltip(newTooltip: string) {
        if (newTooltip) {
            this._tooltip = newTooltip;
        }
    }

    public get tooltip(): string {
        if (this._tooltip) {
            return this._tooltip;
        }
        if (this.job) {
            if (this.job.retcode) {
                return `${this.job.jobname}(${this.job.jobid}) - ${this.job.retcode}`;
            } else {
                return `${this.job.jobname}(${this.job.jobid})`;
            }
        } else {
            return this.label;
        }
    }

    public set owner(newOwner: string) {
        if (newOwner !== undefined) {
            if (newOwner.length === 0) {
                this._owner = this.session.ISession.user;
            } else {
                this._owner = newOwner;
            }
        }
    }

    public get owner(): string {
        return this._owner;
    }

    public set status(newStatus: string) {
        if (newStatus) {
            this._jobStatus = newStatus;
        }
    }

    public get status(): string {
        return this._jobStatus;
    }

    public set prefix(newPrefix: string) {
        if (newPrefix !== undefined) {
            if (newPrefix.length === 0) {
                this._prefix = "*";
            } else {
                this._prefix = newPrefix;
            }
        }
    }

    public get prefix(): string {
        return this._prefix;
    }

    public set searchId(newId: string) {
        if (newId !== undefined) {
            this._searchId = newId;
        }
    }

    public get searchId(): string {
        return this._searchId;
    }

    private statusNotSupportedMsg(status: string): void {
        ZoweLogger.trace("ZoweJobNode.statusNotSupportedMsg called.");
        if (status !== "*") {
            Gui.warningMessage(
                vscode.l10n.t("Filtering by job status is not yet supported with this profile type. Will show jobs with all statuses.")
            );
        }
    }

    private async getJobs(owner: string, prefix: string, searchId: string, status: string): Promise<zowe.IJob[]> {
        ZoweLogger.trace("ZoweJobNode.getJobs called.");
        let jobsInternal: zowe.IJob[] = [];
        const cachedProfile = Profiles.getInstance().loadNamedProfile(this.getProfileName());
        try {
            if (this.searchId.length > 0) {
                jobsInternal.push(await ZoweExplorerApiRegister.getJesApi(cachedProfile).getJob(searchId));
            } else {
                if (!ZoweExplorerApiRegister.getJesApi(cachedProfile).getSession(cachedProfile)) {
                    throw new zowe.imperative.ImperativeError({
                        msg: vscode.l10n.t("Profile auth error"),
                        additionalDetails: vscode.l10n.t("Profile is not authenticated, please log in to continue"),
                        errorCode: `${zowe.imperative.RestConstants.HTTP_STATUS_401}`,
                    });
                }
                if (ZoweExplorerApiRegister.getJesApi(cachedProfile).getJobsByParameters) {
                    jobsInternal = await ZoweExplorerApiRegister.getJesApi(cachedProfile).getJobsByParameters({
                        owner,
                        prefix,
                        status,
                    });
                } else {
                    this.statusNotSupportedMsg(status);
                    jobsInternal = await ZoweExplorerApiRegister.getJesApi(cachedProfile).getJobsByOwnerAndPrefix(owner, prefix);
                }

                /**
                 *    Note: Temporary fix
                 *    This current fix is necessary since in certain instances the Zowe
                 *    Explorer JES API returns duplicate jobs. The following reduce function
                 *    filters only the unique jobs present by comparing the ids of these returned
                 *    jobs.
                 */
                jobsInternal = jobsInternal.reduce((acc: zowe.IJob[], current) => {
                    const duplicateJobExists = acc.find((job) => job.jobid === current.jobid);
                    if (!duplicateJobExists) {
                        return acc.concat([current]);
                    } else {
                        return acc;
                    }
                }, []);
            }
        } catch (error) {
            ZoweLogger.trace("Error getting jobs from Rest API.");
            await errorHandling(error, cachedProfile.name, vscode.l10n.t("Retrieving response from zowe.GetJobs"));
            syncSessionNode(Profiles.getInstance())((profileValue) => ZoweExplorerApiRegister.getJesApi(profileValue).getSession())(
                this.getSessionNode()
            );
        }
        return jobsInternal;
    }
}

export class Spool extends Job {
    public uniqueName: string;
    public constructor(
        label: string,
        mCollapsibleState: vscode.TreeItemCollapsibleState,
        mParent: IZoweJobTreeNode,
        session: zowe.imperative.Session,
        public spool: zowe.IJobFile,
        job: zowe.IJob,
        parent: IZoweJobTreeNode
    ) {
        super(label, mCollapsibleState, mParent, session, job, parent.getProfile());
        this.uniqueName = buildUniqueSpoolName(spool);
        this.resourceUri = mParent.resourceUri.with({
            path: `/${parent.getProfile().name}/${mParent.job.jobid}/${this.uniqueName}`,
        });
        this.tooltip = label;
        this.contextValue = globals.JOBS_SPOOL_CONTEXT;
        const icon = getIconByNode(this);

        if (icon) {
            this.iconPath = icon.path;
        }
    }
}
