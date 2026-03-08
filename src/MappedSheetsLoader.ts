import { MappedServiceBase } from '@kylebrodeur/type-safe-mapping';
import type { MappingDefinition, MappedType } from '@kylebrodeur/type-safe-mapping';

/**
 * Minimal interface that any Google Sheets source must satisfy.
 * Accepting an interface here (rather than the concrete class) avoids
 * circular module dependencies and makes the loader easily testable.
 */
export interface SheetSource {
  loadWithHeaders(sheetId: string, range: string): Promise<Record<string, string>[]>;
}

/**
 * Abstract base class that combines a Google Sheets source with type-safe field mapping.
 *
 * Extend this class, implement `fieldMapping` to declare how sheet column headers
 * map to your internal model fields, then call `loadMapped()` to get fully typed rows.
 *
 * @example
 * ```ts
 * import { SheetsLoader } from '@kylebrodeur/sheets-loader';
 * import { MappedSheetsLoader } from '@kylebrodeur/sheets-loader/mapped';
 *
 * type SheetRow  = { 'First Name': string; Email: string; 'Sign Up Date': string };
 * type UserModel = { firstName: string; email: string; signUpDate: string };
 *
 * class UserSheetLoader extends MappedSheetsLoader<SheetRow, typeof mapping> {
 *   protected fieldMapping = {
 *     'First Name':   'firstName',
 *     'Email':        'email',
 *     'Sign Up Date': 'signUpDate',
 *   } as const;
 * }
 *
 * const sheetsLoader = new SheetsLoader({ auth: { credentials: './service-account.json' } });
 * const loader = new UserSheetLoader(sheetsLoader);
 * const users = await loader.loadMapped('SPREADSHEET_ID', 'Users!A1:C500');
 * // users: UserModel[]
 * ```
 *
 * @typeParam TSource  - Object type matching the sheet's column headers (string values only)
 * @typeParam TMapping - Field mapping produced by `as const` on your `fieldMapping` object
 */
export abstract class MappedSheetsLoader<
  TSource extends Record<string, string>,
  TMapping extends MappingDefinition<TSource>,
> extends MappedServiceBase<TSource, TMapping> {
  constructor(private readonly source: SheetSource) {
    super();
  }

  /**
   * Loads a range, treats the first row as column headers, and maps every
   * subsequent row to the internal model shape defined by `fieldMapping`.
   */
  async loadMapped(sheetId: string, range: string): Promise<MappedType<TSource, TMapping>[]> {
    const rows = await this.source.loadWithHeaders(sheetId, range);
    return rows.map((row) => this.map(row as Partial<TSource>));
  }
}
