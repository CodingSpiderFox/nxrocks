import { Tree, logger, readProjectConfiguration, readJson } from '@nrwl/devkit';
import { appRootPath } from '@nrwl/workspace/src/utils/app-root';

import { createTreeWithEmptyWorkspace } from '@nrwl/devkit/testing';

import { projectGenerator } from './generator';
import { ProjectGeneratorOptions } from './schema';

import { Readable } from 'stream';

//mock 'node-fetch' to avoid making the actual call to Spring Initializer
jest.mock('node-fetch');
import fetch from 'node-fetch';
const { Response } = jest.requireActual('node-fetch');

//mock fs.chmodSync
jest.mock('fs');
import * as fs from 'fs';

describe('project generator', () => {
  let tree: Tree;
  const options: ProjectGeneratorOptions = {
    name: 'bootapp',
    projectType: 'application',
    springInitializerUrl: 'https://start.spring.io'
  };

  const mockedFetch = (fetch as jest.MockedFunction<typeof fetch>);
  const mockedResponse = new Response(Readable.from(['starter.zip']));

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    jest.spyOn(fs, 'chmodSync');
    jest.spyOn(logger, 'info');
    jest.spyOn(logger, 'debug');
    jest.spyOn(mockedResponse.body, 'pipe').mockReturnValue({ promise: () => jest.fn() });
    mockedFetch.mockResolvedValue(mockedResponse);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it.each`
    projectType      | buildSystem         | buildFile         | wrapperName
    ${'application'} | ${'maven-project'}  | ${'pom.xml'}      | ${'mvnw'}
    ${'application'} | ${'gradle-project'} | ${'build.gradle'} | ${'gradlew'}
    ${'library'}     | ${'maven-project'}  | ${'pom.xml'}      | ${'mvnw'}
    ${'library'}     | ${'gradle-project'} | ${'build.gradle'} | ${'gradlew'}
  `(`should download a spring boot '$projectType' build with $buildSystem`, async ({ projectType, buildSystem, buildFile, wrapperName }) => {

    const rootDir = projectType === 'application' ? 'apps': 'libs';
    
    tree.write(`/${rootDir}/${options.name}/${buildFile}`, '');

    await projectGenerator(tree, { ...options, projectType, buildSystem});

    expect(mockedFetch).toHaveBeenCalledWith(
      `${options.springInitializerUrl}/starter.zip?type=${buildSystem}&name=${options.name}`,
      expect.objectContaining({
        headers: {
          'User-Agent': expect.stringContaining('@nxrocks_nx-spring-boot/')
        }
      })
    );

    expect(logger.info).toHaveBeenNthCalledWith(1, `Downloading Spring Boot project zip from : ${options.springInitializerUrl}/starter.zip?type=${buildSystem}&name=${options.name}...`);

    expect(logger.info).toHaveBeenNthCalledWith(2, `Extracting Spring Boot project zip to '${appRootPath}/${rootDir}/${options.name}'...`);

    expect(logger.debug).toHaveBeenNthCalledWith(1, `Restoring write permission on wrapper executable at '${appRootPath}/${rootDir}/${options.name}/${wrapperName}'...`);

    expect(fs.chmodSync).toHaveBeenCalledWith(expect.stringContaining(`/${rootDir}/${options.name}/${wrapperName}`), 0o755);

    if (buildSystem === 'gradle-project') {
      expect(logger.debug).toHaveBeenNthCalledWith(2, `Adding 'buildInfo' task to the build.gradle file...`);
    }
  });

  it('should update workspace.json', async () => {
    await projectGenerator(tree, options);
    const project = readProjectConfiguration(tree, options.name);
    expect(project.root).toBe(`apps/${options.name}`);

    const commands = ['run', 'serve', 'test', 'clean', 'buildJar', 'buildWar', 'buildImage', 'buildInfo'];
    commands.forEach(cmd => {
      expect(project.targets[cmd].executor).toBe(`@nxrocks/nx-spring-boot:${cmd}`);
    });
  });

  it('should add plugin to nx.json', async () => {
    await projectGenerator(tree, options);
    const nxJson = readJson(tree, 'nx.json');
    expect(nxJson.plugins).toEqual(['@nxrocks/nx-spring-boot']);

  });

});

