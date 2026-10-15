CREATE TYPE "public"."company_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "company_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"nuit" text,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"city" text,
	"employees_estimate" integer,
	"plan_id" uuid,
	"message" text,
	"status" "company_request_status" DEFAULT 'pending' NOT NULL,
	"company_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_requests" ADD CONSTRAINT "company_requests_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_requests" ADD CONSTRAINT "company_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_requests" ADD CONSTRAINT "company_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_requests_status_idx" ON "company_requests" USING btree ("status","created_at");