import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1760175650514 implements MigrationInterface {
  name = 'InitSchema1760175650514';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "membership" ("workspace_id" integer NOT NULL, "user_id" character varying(64) NOT NULL, "role" character varying(25) NOT NULL DEFAULT 'member', "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c812b1092cf66d72ddac549a6b4" PRIMARY KEY ("workspace_id", "user_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d427c9fcee4242d77174a9fcc" ON "membership" ("workspace_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_e9c72e8d29784031c96f5c6af8" ON "membership" ("user_id") `);
    await queryRunner.query(
      `CREATE TABLE "workspace" ("id" SERIAL NOT NULL, "uuid" uuid NOT NULL DEFAULT uuid_generate_v4(), "image" character varying(50) NOT NULL, "name" character varying(30) NOT NULL, "description" text NOT NULL, "status" character varying(30) NOT NULL, "dedicated" boolean NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ee78a3da1b84780b34a739d04ab" UNIQUE ("uuid"), CONSTRAINT "PK_ca86b6f9b3be5fe26d307d09b49" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "access_code" ("id" SERIAL NOT NULL, "code" character varying NOT NULL, "uid" character varying(64) NOT NULL, "uuid" character varying(64) NOT NULL, "status" character varying NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_f6519d3be9ac14e21c00e594a58" UNIQUE ("code"), CONSTRAINT "PK_31c26435c0d26a2ce6bee4a763b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "membership" ADD CONSTRAINT "FK_2d427c9fcee4242d77174a9fccd" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "membership" DROP CONSTRAINT "FK_2d427c9fcee4242d77174a9fccd"`);
    await queryRunner.query(`DROP TABLE "access_code"`);
    await queryRunner.query(`DROP TABLE "workspace"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e9c72e8d29784031c96f5c6af8"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2d427c9fcee4242d77174a9fcc"`);
    await queryRunner.query(`DROP TABLE "membership"`);
  }
}
