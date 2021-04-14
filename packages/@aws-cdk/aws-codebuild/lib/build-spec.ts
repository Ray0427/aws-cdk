import { IResolveContext, Lazy, Stack } from '@aws-cdk/core';
import * as yaml_cfn from './private/yaml-cfn';

export interface BuildSpecEnvProps {
  readonly shell?: string;
  readonly variables?: {
    [key:string]: string;
  };
  readonly 'parameter-store'?: {
    [key:string]: string;
  };
  readonly 'exported-variables'?: {
    [key:string]: string;
  };
  readonly 'secrets-manager'?: {
    [key:string]: string;
  };
  readonly 'git-credential-helper'?: boolean;
};

export interface BuildSpecPhasesBuildProps {
  readonly 'run-as'?: string;
  readonly commands?: string[];
  readonly finally?: string[];
};

export interface BuildSpecPhasesInstallProps extends BuildSpecPhasesBuildProps {
  readonly 'runtime-versions'?: {
    [key: string]: string | number;
  };
}

export interface BuildSpecPhasesProps {
  readonly install?: BuildSpecPhasesInstallProps;
  readonly pre_build?: BuildSpecPhasesBuildProps;
  readonly build?: BuildSpecPhasesBuildProps;
  readonly post_build?: BuildSpecPhasesBuildProps;
};

export interface BuildSpecProxyProps {
  readonly 'upload-artifacts'?: boolean;
  readonly logs?: boolean;
}

export interface BuildSpecReportsProps {
  [key: string]: BuildSpecReportGroupProps
}

export interface BuildSpecReportGroupProps {
  readonly files?: string[];
  readonly 'base-directory'?: string;
  readonly 'discard-paths'?: string;
  readonly 'file-format'?: string;
}

export interface BuildSpecBaseArtifactsProps {
  readonly files?: string[];
  readonly name?: string;
  readonly 'discard-path'?: boolean;
  readonly 'base-directory'?: string;
}

export interface BuildSpecArtifactsSecondaryArtifactsProps {
  readonly [key: string]: BuildSpecBaseArtifactsProps;
}

export interface BuildSpecArtifactsProps extends BuildSpecBaseArtifactsProps{
  readonly 'enable-symlinks'?: boolean;
  readonly 's3-prefix'?: string;
  readonly 'secondary-artifacts': BuildSpecArtifactsSecondaryArtifactsProps;
}

export interface BuildSpecCacheProps {
  readonly paths?: string[];
}

export interface BuildSpecProps {
  readonly version?: string;
  readonly 'run-as'?: string;
  readonly env?: BuildSpecEnvProps;
  readonly proxy?: BuildSpecProxyProps;
  readonly phases?: BuildSpecPhasesProps;
  readonly reports?: BuildSpecReportsProps;
  readonly artifacts?: BuildSpecArtifactsProps;
  readonly cache?: BuildSpecCacheProps;
}

/**
 * BuildSpec for CodeBuild projects
 */
export abstract class BuildSpec {
  public static fromObject(value: BuildSpecProps): BuildSpec {
    return new ObjectBuildSpec(value);
  }

  /**
   * Create a buildspec from an object that will be rendered as YAML in the resulting CloudFormation template.
   *
   * @param value the object containing the buildspec that will be rendered as YAML
   */
  public static fromObjectToYaml(value: {[key: string]: any}): BuildSpec {
    return new YamlBuildSpec(value);
  }

  /**
   * Use a file from the source as buildspec
   *
   * Use this if you want to use a file different from 'buildspec.yml'`
   */
  public static fromSourceFilename(filename: string): BuildSpec {
    return new FilenameBuildSpec(filename);
  }

  /**
   * Whether the buildspec is directly available or deferred until build-time
   */
  public abstract readonly isImmediate: boolean;

  protected constructor() {
  }

  /**
   * Render the represented BuildSpec
   */
  public abstract toBuildSpec(): string;
}

/**
 * BuildSpec that just returns the input unchanged
 */
class FilenameBuildSpec extends BuildSpec {
  public readonly isImmediate: boolean = false;

  constructor(private readonly filename: string) {
    super();
  }

  public toBuildSpec(): string {
    return this.filename;
  }

  public toString() {
    return `<buildspec file: ${this.filename}>`;
  }
}

/**
 * BuildSpec that understands about structure
 */
class ObjectBuildSpec extends BuildSpec {
  public readonly isImmediate: boolean = true;

  constructor(public readonly spec: {[key: string]: any}) {
    super();
  }

  public toBuildSpec(): string {
    // We have to pretty-print the buildspec, otherwise
    // CodeBuild will not recognize it as an inline buildspec.
    return Lazy.uncachedString({
      produce: (ctx: IResolveContext) =>
        Stack.of(ctx.scope).toJsonString(this.spec, 2),
    });
  }
}

/**
 * BuildSpec that exports into YAML format
 */
class YamlBuildSpec extends BuildSpec {
  public readonly isImmediate: boolean = true;

  constructor(public readonly spec: {[key: string]: any}) {
    super();
  }

  public toBuildSpec(): string {
    return yaml_cfn.serialize(this.spec);
  }
}

/**
 * Merge two buildspecs into a new BuildSpec
 *
 * NOTE: will currently only merge commands, not artifact
 * declarations, environment variables, secrets, or any
 * other configuration elements.
 *
 * Internal for now because it's not complete/good enough
 * to expose on the objects directly, but we need to it to
 * keep feature-parity for Project.
 *
 * @internal
 */
export function mergeBuildSpecs(lhs: BuildSpec, rhs: BuildSpec): BuildSpec {
  if (!(lhs instanceof ObjectBuildSpec) || !(rhs instanceof ObjectBuildSpec)) {
    throw new Error('Can only merge buildspecs created using BuildSpec.fromObject()');
  }

  return new ObjectBuildSpec(copyCommands(lhs.spec, rhs.spec));
}

/**
 * Extend buildSpec phases with the contents of another one
 */
function copyCommands(buildSpec: any, extend: any): any {
  if (buildSpec.version === '0.1') {
    throw new Error('Cannot extend buildspec at version "0.1". Set the version to "0.2" or higher instead.');
  }

  const ret = Object.assign({}, buildSpec); // Return a copy
  ret.phases = Object.assign({}, ret.phases);

  for (const phaseName of Object.keys(extend.phases)) {
    const phase = ret.phases[phaseName] = Object.assign({}, ret.phases[phaseName]);
    phase.commands = [...phase.commands || [], ...extend.phases[phaseName].commands];
  }

  return ret;
}