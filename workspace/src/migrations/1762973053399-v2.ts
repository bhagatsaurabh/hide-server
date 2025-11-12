import { MigrationInterface, QueryRunner } from 'typeorm';

export class V21762973053399 implements MigrationInterface {
  name = 'V21762973053399';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "access_code" ADD "ntfnId" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "access_code" DROP COLUMN "ntfnId"`);
  }
}
