import { describe, it } from "node:test";

import compile from "../../../../../src/internal/builtin-plugins/solidity/tasks/compile.js";
import {
  TestProject,
  TestProjectTemplate,
  useTestProjectTemplate,
} from "./resolver/helpers.js";
import { createHardhatRuntimeEnvironment } from "../../../../../src/hre.js";
import assert from "node:assert";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { HardhatRuntimeEnvironment } from "../../../../../src/types/hre.js";
import { getAllFilesMatching } from "@nomicfoundation/hardhat-utils/fs";

async function getHRE(project: TestProject) {
  return createHardhatRuntimeEnvironment({}, {}, project.path);
}

interface FileDetail {
  path: string;
  modificationTime: Date;
}

class TestProjectWrapper {
  constructor(
    public project: TestProject,
    public hre: HardhatRuntimeEnvironment,
  ) {}

  async compile(options: any = {}) {
    await this.hre.tasks.getTask(["compile"]).run({ ...options, quiet: true });
  }

  async getSnapshot() {
    const buildInfos = await this.getBuildInfoFiles();
    const artifacts = await this.getArtifacts();
    const typeFiles = await this.getTypefiles();

    const buildIdReferences = await this.getBuildIdReferences(artifacts);
    // const modificationTimes = await this.getModificationTimes();

    return {
      buildInfos,
      artifacts,
      typeFiles,
      buildIdReferences,
      // modifiedTime: { "/path/A.json": "date" },
    };
  }

  buildInfosBasePath() {
    return path.join(this.project.path, "artifacts", "build-info");
  }

  artifactsBasePath() {
    return path.join(this.project.path, "artifacts", "contracts");
  }

  async getBuildInfoFiles() {
    const filePaths = (await readdir(this.buildInfosBasePath()))
      .filter((filePath) => !filePath.endsWith(".output.json"))
      .map((basename) => path.join(this.buildInfosBasePath(), basename));

    return Promise.all(
      filePaths.map(async (filePath) => ({
        path: filePath,
        modificationTime: await this.getModificationTime(filePath),
        buildId: path.basename(filePath).replace(".json", ""),
      })),
    );
  }

  async getModificationTime(filePath: string) {
    return (await stat(filePath)).ctime;
  }

  async getArtifactFolders() {
    return readdir(this.artifactsBasePath());
  }

  async getArtifacts() {
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

  async getTypefiles() {
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

  async getBuildIdReferences(artifacts: Record<string, FileDetail[]>) {
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

  getSourcenameFromArtifactPath(artifactPath: string) {
    return artifactPath
      .replace(`${this.artifactsBasePath() + path.sep}`, "")
      .replace(`${path.sep + path.basename(artifactPath)}`, "");
  }
}

describe.only("Partial compilation", () => {
  describe("Compiling a project from scratch", () => {
    describe("Project with two independent files", () => {
      describe("Non-isolated", () => {
        it("artifacts from both files should point to a single build info", async () => {
          await using _project = await useTestProjectTemplate({
            name: "test",
            version: "1.0.0",
            files: {
              "contracts/A.sol": `contract A {} contract A2 {}`,
              "contracts/B.sol": `contract B {} contract B2 {}`,
            },
          });
          const hre = await getHRE(_project);
          const project = new TestProjectWrapper(_project, hre);

          // Compile first time
          await project.compile();

          const firstSnapshot = await project.getSnapshot();
          const { buildInfos, artifacts, typeFiles, buildIdReferences } =
            firstSnapshot;

          // There should be only 1 build info including A and B
          assert.equal(buildInfos.length, 1);
          const [buildInfo] = buildInfos;

          // There should be 2 artifact folders and 2 artifacts each
          assert.equal(artifacts["A.sol"].length, 2);
          assert.equal(artifacts["B.sol"].length, 2);

          // All artifacts should point to the single build info
          for (const artifact of artifacts["A.sol"]) {
            assert.equal(buildIdReferences[artifact.path], buildInfo.buildId);
          }
          for (const artifact of artifacts["B.sol"]) {
            assert.equal(buildIdReferences[artifact.path], buildInfo.buildId);
          }

          // There should be 1 type definition file per source file
          assert.ok(typeFiles["A.sol"] !== undefined);
          assert.ok(typeFiles["B.sol"] !== undefined);

          // Recompile
          await project.compile();

          const secondSnapshot = await project.getSnapshot();

          // Nothing in the snapshot should have changed
          assert.deepEqual(firstSnapshot, secondSnapshot);
        });
      });

      describe("Isolated", () => {
        it("artifacts from each file should point to its individual build info", async () => {
          await using _project = await useTestProjectTemplate({
            name: "test",
            version: "1.0.0",
            files: {
              "contracts/A.sol": `contract A {} contract A2 {}`,
              "contracts/B.sol": `contract B {} contract B2 {}`,
            },
          });
          const hre = await getHRE(_project);
          const project = new TestProjectWrapper(_project, hre);

          // Compile first time
          await project.compile({ isolated: true });

          const firstSnapshot = await project.getSnapshot();
          const { buildInfos, artifacts, typeFiles, buildIdReferences } =
            firstSnapshot;

          // There should be 2 build infos
          assert.equal(buildInfos.length, 2);

          // There should be 2 artifact folders and 2 artifacts each
          assert.equal(artifacts["A.sol"].length, 2);
          assert.equal(artifacts["B.sol"].length, 2);

          // Artifacts from A should point to a build info and artifacts from B to a different one
          const buildInfoA = buildIdReferences[artifacts["A.sol"][0].path];
          const buildInfoB = buildIdReferences[artifacts["B.sol"][0].path];
          assert.notEqual(buildInfoA, buildInfoB);

          // There should be 1 type definition file per source file
          assert.ok(typeFiles["A.sol"] !== undefined);
          assert.ok(typeFiles["B.sol"] !== undefined);

          // Recompile
          await project.compile();

          const secondSnapshot = await project.getSnapshot();

          // Nothing in the snapshot should have changed
          assert.deepEqual(firstSnapshot, secondSnapshot);
        });
      });
    });

    // describe("Project with two connected files", () => {
    //   describe("Non-isolated", () => {
    //     it("should (...)", async () => {});
    //   });

    //   describe("Isolated", () => {
    //     it("should (...)", async () => {});
    //   });
    // });

    // describe("Project with three files (A -> B -> C)", () => {
    //   describe("Non-isolated", () => {
    //     it("should (...)", async () => {});
    //   });

    //   describe("Isolated", () => {
    //     it("should (...)", async () => {});
    //   });
    // });

    // describe("Project with three files (A -> B <- C)", () => {
    //   describe("Non-isolated", () => {
    //     it("should (...)", async () => {});
    //   });

    //   describe("Isolated", () => {
    //     it("should (...)", async () => {});
    //   });
    // });

    // describe("Project with three files (A -> B, C)", () => {
    //   describe("Non-isolated", () => {
    //     it("should (...)", async () => {});
    //   });

    //   describe("Isolated", () => {
    //     it("should (...)", async () => {});
    //   });
    // });
  });

  // describe("Modifications to a one-file project", () => {
  //   describe("Modify a file", () => {
  //     it("should (...)", async () => {});
  //   });

  //   describe("Add a file, then modify both", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Remove the file", () => {
  //     it("should (...)", async () => {});
  //   });

  //   describe("Add a dependency", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Add a dependant", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });
  // });

  // describe("Modifications to a project with two independent files", () => {
  //   describe("Modify one file", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Delete one file, then modify the remaining file", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });
  // });

  // describe("Modifications to a project with two connected files", () => {
  //   describe("Modify the dependency", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Modify the dependant", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Remove the dependency", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Remove the dependant", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });
  // });

  // describe("Modifications to a project with three files (A -> B -> C)", () => {
  //   describe("Modify the deepest dependency", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Modify the file in the middle", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Modify the bottom dependant", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Delete the top dependency", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Delete the file in the middle", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Delete the bottom dependant", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });
  // });

  // describe("Modifications to a project with three files (A -> B <- C)", () => {
  //   describe("Modify the dependency", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Modify one of the dependants", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Delete the dependency", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Delete one of the dependants", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });
  // });

  // describe("Modifications to a project with three files (A -> B, C)", () => {
  //   describe("Modify the dependency", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Modify the dependant", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Modify the independent file", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Delete the dependency", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Delete the dependant", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });

  //   describe("Delete the independent file", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });
  // });

  // describe("Compiling subsets of files", () => {
  //   describe("Compile a single file in a project with one file", () => {
  //     it("should (...)", async () => {});
  //   });

  //   describe("Compile a single file in a project with thwo independent files", () => {
  //     describe("Non-isolated", () => {
  //       it("should (...)", async () => {});
  //     });

  //     describe("Isolated", () => {
  //       it("should (...)", async () => {});
  //     });
  //   });
  // });
});
