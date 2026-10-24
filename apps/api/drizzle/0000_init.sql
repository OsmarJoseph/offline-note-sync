CREATE TYPE "public"."operation_status" AS ENUM('applied', 'conflict', 'note_not_found');--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"op_id" uuid PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"base_revision" integer NOT NULL,
	"text" text NOT NULL,
	"status" "operation_status" NOT NULL,
	"revision" integer,
	CONSTRAINT "operations_revision_unless_note_not_found" CHECK (("operations"."status" = 'note_not_found') = ("operations"."revision" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operations_applied_revision_unique" ON "operations" USING btree ("note_id","revision") WHERE "operations"."status" = 'applied';