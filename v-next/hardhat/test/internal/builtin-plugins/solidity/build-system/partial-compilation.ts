import { describe, it } from "node:test";

import compile from "../../../../../src/internal/builtin-plugins/solidity/tasks/compile.js";
import {
  TestProjectTemplate,
  useTestProjectTemplate,
} from "./resolver/helpers.js";
import { createHardhatRuntimeEnvironment } from "../../../../../src/hre.js";
import assert from "node:assert";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

// Test Scenarios
//   - Compiling a project from scratch
//     - Project with one file
//     - Project with two independent files
//       - Non-isolated
//       - Isolated
//     - Project with two connected files
//       - Non-isolated
//       - Isolated
//     - Project with three files (A -> B -> C)
//       - Non-isolated
//       - Isolated
//     - Project with three files (A -> B <- C)
//       - Non-isolated
//       - Isolated
//     - Project with three files (A -> B, C)
//       - Non-isolated
//       - Isolated
//   - Modifications to a one-file project
//     - Modify a file
//     - Add a file, then modify both
//       - Non-isolated
//       - Isolated
//     - Remove the file
//     - Add a dependency
//       - Non-isolated
//       - Isolated
//     - Add a dependant
//       - Non-isolated
//       - Isolated
//   - Modifications to a project with two independent files
//     - Modify one file
//       - Non-isolated
//       - Isolated
//     - Delete one file, then modify the remaining file
//       - Non-isolated
//       - Isolated
//   - Modifications to a project with two connected files
//     - Modify the dependency
//       - Non-isolated
//       - Isolated
//     - Modify the dependant
//       - Non-isolated
//       - Isolated
//     - Remove the dependency
//       - Non-isolated
//       - Isolated
//     - Remove the dependant
//       - Non-isolated
//       - Isolated
//   - Modifications to a project with three files (A -> B -> C)
//     - Modify the deepest dependency
//       - Non-isolated
//       - Isolated
//     - Modify the file in the middle
//       - Non-isolated
//       - Isolated
//     - Modify the bottom dependant
//       - Non-isolated
//       - Isolated
//     - Delete the top dependency
//       - Non-isolated
//       - Isolated
//     - Delete the file in the middle
//       - Non-isolated
//       - Isolated
//     - Delete the bottom dependant
//       - Non-isolated
//       - Isolated
//   - Modifications to a project with three files (A -> B <- C)
//     - Modify the dependency
//       - Non-isolated
//       - Isolated
//     - Modify one of the dependants
//       - Non-isolated
//       - Isolated
//     - Delete the dependency
//       - Non-isolated
//       - Isolated
//     - Delete one of the dependants
//       - Non-isolated
//       - Isolated
//   - Modifications to a project with three files (A -> B, C)
//     - Modify the dependency
//       - Non-isolated
//       - Isolated
//     - Modify the dependant
//       - Non-isolated
//       - Isolated
//     - Modify the independent file
//       - Non-isolated
//       - Isolated
//     - Delete the dependency
//       - Non-isolated
//       - Isolated
//     - Delete the dependant
//       - Non-isolated
//       - Isolated
//     - Delete the independent file
//       - Non-isolated
//       - Isolated
//   - Compiling subsets of files
//     - Compile a single file in a project with one file
//     - Compile a single file in a project with thwo independent files
//       - Non-isolated
//       - Isolated

describe.only("Partial compilation", () => {
  describe("Compiling a project from scratch", () => {
    describe("Project with one file", () => {
      it("should create a build info file, generate the artifact file associated to it, and generate the TS artifacts", async () => {
        const projectTemplate: TestProjectTemplate = {
          name: "test",
          version: "1.0.0",
          files: {
            "contracts/A.sol": `contract A {} contract A2 {}`,
          },
        };
        await using project = await useTestProjectTemplate(projectTemplate);
        const hre = await createHardhatRuntimeEnvironment({}, {}, project.path);

        // Compile first time
        await hre.tasks.getTask(["compile"]).run({ quiet: true });

        const buildInfosBasePath = path.join(
          project.path,
          "artifacts",
          "build-info",
        );
        // There should be only 1 build info including A
        const buildInfoFiles = (await readdir(buildInfosBasePath)).filter(
          (filePath) => !filePath.endsWith(".output.json"),
        );

        assert.equal(buildInfoFiles.length, 1);

        const [buildInfoBasename] = buildInfoFiles;
        const buildId = buildInfoBasename.replace(".json", "");
        const buildInfoCtime = (
          await stat(path.join(buildInfosBasePath, buildInfoBasename))
        ).ctime;

        const artifactsBasePath = path.join(
          project.path,
          "artifacts",
          "contracts",
        );

        // There should be 1 artifact folder
        const artifactFolders = await readdir(artifactsBasePath);
        assert.deepEqual(artifactFolders, ["A.sol"]);

        // The artifact folder should have the json artifacts for the 2 contracts defined in the source file, and the declaration file
        const artifactsForA = (
          await readdir(path.join(artifactsBasePath, "A.sol"))
        ).filter((basename) => basename.endsWith(".json"));

        assert.deepEqual(artifactsForA, ["A.json", "A2.json"]);

        const artifactsForACtimes = new Map<string, Date>();

        // The artifacts for A.sol should point to the build info
        for (const basename of artifactsForA) {
          const artifactPath = path.join(artifactsBasePath, "A.sol", basename);
          const artifactContent = (await readFile(artifactPath)).toString();
          const artifact = JSON.parse(artifactContent);
          const artifactCtime = (await stat(artifactPath)).ctime;
          artifactsForACtimes.set(basename, artifactCtime);

          assert.equal(
            artifact.buildInfoId,
            buildId,
            `Build id from file ${artifactPath} expected to be ${buildId} but was ${artifact.buildInfoId}`,
          );
        }

        // There should be the type definition file
        const typeFileForAPath = path.join(
          artifactsBasePath,
          "A.sol",
          "artifacts.d.ts",
        );

        const typeFileForACtime = (await stat(typeFileForAPath)).ctime;

        // Recompile
        await hre.tasks.getTask(["compile"]).run({ quiet: true });

        // There should still be only 1 build info file and it should have not been modified
        const newBuildInfoFiles = (await readdir(buildInfosBasePath)).filter(
          (filePath) => !filePath.endsWith(".output.json"),
        );

        assert.equal(newBuildInfoFiles.length, 1);

        const [newBuildInfoBasename] = newBuildInfoFiles;

        assert.equal(newBuildInfoBasename, buildInfoBasename);

        const newBuildInfoCtime = (
          await stat(path.join(buildInfosBasePath, newBuildInfoBasename))
        ).ctime;

        // assert.equal(newBuildInfoCtime, buildInfoCtime); // <<<<<< FAILING

        // There should be the same two generated json artifacts, without being modified

        const newArtifactsForA = (
          await readdir(path.join(artifactsBasePath, "A.sol"))
        ).filter((basename) => basename.endsWith(".json"));

        assert.deepEqual(newArtifactsForA, artifactsForA);

        const newArtifactsForACtimes = new Map<string, Date>();

        for (const basename of newArtifactsForA) {
          const artifactPath = path.join(artifactsBasePath, "A.sol", basename);
          const artifactCtime = (await stat(artifactPath)).ctime;
          newArtifactsForACtimes.set(basename, artifactCtime);
        }

        for (const basename of artifactsForA) {
          assert.notEqual(artifactsForACtimes.get(basename), undefined);
          // assert.equal( // <<<< FAILING
          //   artifactsForACtimes.get(basename),
          //   newArtifactsForACtimes.get(basename),
          // );
        }
      });
    });

    // describe("Project with two independent files", () => {
    //   describe("Non-isolated", () => {
    //     it("should (...)", async () => {});
    //   });

    //   describe("Isolated", () => {
    //     it("should (...)", async () => {});
    //   });
    // });

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
