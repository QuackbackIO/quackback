ALTER TABLE "changelog_entries" DROP CONSTRAINT "changelog_entries_board_id_boards_id_fk";
--> statement-breakpoint
DROP INDEX "changelog_board_id_idx";--> statement-breakpoint
ALTER TABLE "changelog_entries" DROP COLUMN "board_id";