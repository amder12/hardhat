import path from "path";
import { createHardhatRuntimeEnvironment } from "../../../../../../src/internal/hre-initialization.js";
import { HardhatRuntimeEnvironment } from "../../../../../../src/types/hre.js";
import { TestProject } from "../resolver/helpers.js";
import { readdir, readFile, stat } from "fs/promises";
import {
  getAllFilesMatching,
  readJsonFile,
} from "@nomicfoundation/hardhat-utils/fs";
import { BuildInfo } from "../../../../../../src/types/artifacts.js";

export async function getHRE(
  project: TestProject,
): Promise<HardhatRuntimeEnvironment> {
  return createHardhatRuntimeEnvironment({}, {}, project.path);
}

export interface FileDetail {
  path: string;
  modificationTime: Date;
}

interface BuildInfoDetail {
  path: string;
  modificationTime: any;
  buildId: string;
  sources: string[];
}

interface Snapshot {
  buildInfos: BuildInfoDetail[];
  buildInfoOutputs: {
    path: string;
    modificationTime: any;
    buildId: string;
  }[];
  artifacts: Record<string, FileDetail[]>;
  typeFiles: Record<string, FileDetail>;
  buildIdReferences: Record<string, string>;
}

export class TestProjectWrapper {
  constructor(
    public project: TestProject,
    public hre: HardhatRuntimeEnvironment,
  ) {}

  async compile(options: any = {}): Promise<void> {
    await this.hre.tasks.getTask(["compile"]).run({ ...options, quiet: true });
  }

  async getSnapshot(): Promise<Snapshot> {
    const buildInfos = await this.getBuildInfoFiles();
    const buildInfoOutputs = await this.getBuildInfoOutputFiles();
    const artifacts = await this.getArtifacts();
    const typeFiles = await this.getTypefiles();

    const buildIdReferences = await this.getBuildIdReferences(artifacts);
    // const modificationTimes = await this.getModificationTimes();

    return {
      buildInfos,
      buildInfoOutputs,
      artifacts,
      typeFiles,
      buildIdReferences,
    };
  }

  buildInfosBasePath(): string {
    return path.join(this.project.path, "artifacts", "build-info");
  }

  artifactsBasePath(): string {
    return path.join(this.project.path, "artifacts", "contracts");
  }

  async getBuildInfoFiles(): Promise<
    {
      path: string;
      modificationTime: any;
      buildId: string;
      sources: string[];
    }[]
  > {
    const filePaths = (await readdir(this.buildInfosBasePath()))
      .filter((filePath) => !filePath.endsWith(".output.json"))
      .map((basename) => path.join(this.buildInfosBasePath(), basename));

    return Promise.all(
      filePaths.map(async (filePath) => {
        const modificationTime = await this.getModificationTime(filePath);
        const buildId = path.basename(filePath).replace(".json", "");
        const sources = Object.keys(
          ((await readJsonFile(filePath)) as BuildInfo).input.sources,
        ).map((sourceName) => sourceName.replace("project/contracts/", ""));

        return {
          path: filePath,
          modificationTime,
          buildId,
          sources,
        };
      }),
    );
  }

  async getBuildInfoOutputFiles(): Promise<
    {
      path: string;
      modificationTime: any;
      buildId: string;
    }[]
  > {
    const filePaths = (await readdir(this.buildInfosBasePath()))
      .filter((filePath) => filePath.endsWith(".output.json"))
      .map((basename) => path.join(this.buildInfosBasePath(), basename));

    return Promise.all(
      filePaths.map(async (filePath) => ({
        path: filePath,
        modificationTime: await this.getModificationTime(filePath),
        buildId: path.basename(filePath).replace(".output.json", ""),
      })),
    );
  }

  async getModificationTime(filePath: string): Promise<Date> {
    return (await stat(filePath)).ctime;
  }

  async getArtifactFolders(): Promise<string[]> {
    return readdir(this.artifactsBasePath());
  }

  async getArtifacts(): Promise<Record<string, FileDetail[]>> {
    const artifacts: Record<string, FileDetail[]> = {};

    const artifactPaths = await getAllFilesMatching(
      this.artifactsBasePath(),
      (path) => path.endsWith(".json"),
    );

    for (const artifactPath of artifactPaths) {
      const sourceName = artifactPath
        .replace(`${this.artifactsBasePath() + path.sep}`, "")
        .replace(`${path.sep + path.basename(artifactPath)}`, "");

      artifacts[sourceName] ??= [];
      artifacts[sourceName].push({
        path: artifactPath,
        modificationTime: await this.getModificationTime(artifactPath),
      });
    }

    return artifacts;
  }

  async getTypefiles(): Promise<Record<string, FileDetail>> {
    const typefiles: Record<string, FileDetail> = {};

    const typefilePaths = await getAllFilesMatching(
      this.artifactsBasePath(),
      (path) => path.endsWith("artifacts.d.ts"),
    );

    for (const typefilePath of typefilePaths) {
      const sourceName = this.getSourcenameFromArtifactPath(typefilePath);
      typefiles[sourceName] = {
        path: typefilePath,
        modificationTime: await this.getModificationTime(typefilePath),
      };
    }

    return typefiles;
  }

  async getBuildIdReferences(
    artifacts: Record<string, FileDetail[]>,
  ): Promise<Record<string, string>> {
    const buildIdReferences: Record<string, string> = {};

    const artifactPaths = Object.values(artifacts)
      .flat()
      .map((f) => f.path);

    for (const artifactPath of artifactPaths) {
      const artifactContent = (await readFile(artifactPath)).toString();
      const artifact = JSON.parse(artifactContent);
      buildIdReferences[artifactPath] = artifact.buildInfoId;
    }

    return buildIdReferences;
  }

  getSourcenameFromArtifactPath(artifactPath: string): string {
    return artifactPath
      .replace(`${this.artifactsBasePath() + path.sep}`, "")
      .replace(`${path.sep + path.basename(artifactPath)}`, "");
  }

  getBuildInfoForSourceFile(
    snapshot: Snapshot,
    source: string,
  ): BuildInfoDetail {
    const artifacts = snapshot.artifacts[source];

    if (artifacts === undefined || artifacts.length === 0) {
      throw new Error(`No artifacts on snapshot for source ${source}`);
    }

    const buildInfoId = snapshot.buildIdReferences[artifacts[0].path];

    if (buildInfoId === undefined) {
      throw new Error(`No build info reference for ${artifacts[0].path}`);
    }

    const buildInfo = snapshot.buildInfos.find(
      (bi) => bi.buildId === buildInfoId,
    );

    if (buildInfo === undefined) {
      throw new Error(`Couldnt find build info with id ${buildInfoId}`);
    }

    return buildInfo;
  }
}
