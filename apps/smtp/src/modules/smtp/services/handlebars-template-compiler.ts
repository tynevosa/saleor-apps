import Handlebars from "handlebars";
import { createLogger } from "../../../logger";
import { err, ok, Result } from "neverthrow";
import { BaseError } from "../../../errors";

const logger = createLogger("compileHandlebarsTemplate");

export interface ITemplateCompiler {
  compile(
    template: string,
    variables: unknown,
  ): Result<
    { template: string },
    InstanceType<typeof HandlebarsTemplateCompiler.HandlebarsTemplateCompilerError>
  >;
}

export class HandlebarsTemplateCompiler implements ITemplateCompiler {
  static HandlebarsTemplateCompilerError = BaseError.subclass("HandlebarsTemplateCompilerError");
  static FailedCompileError = this.HandlebarsTemplateCompilerError.subclass("FailedCompileError");

  compile(
    template: string,
    variables: any,
  ): Result<
    { template: string },
    InstanceType<typeof HandlebarsTemplateCompiler.HandlebarsTemplateCompilerError>
  > {
    logger.debug("Compiling handlebars template");
    try {
      const templateDelegate = Handlebars.compile(template);
      const htmlTemplate = templateDelegate(variables);

      logger.debug("Template successfully compiled");

      return ok({
        template: htmlTemplate,
      });
    } catch (error) {
      logger.error(error);

      return err(
        new HandlebarsTemplateCompiler.FailedCompileError("Failed to compile template", {
          errors: [error],
        }),
      );
    }
  }
}
