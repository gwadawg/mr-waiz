-- Creative QA is its own onboarding form type, separate from marketing_qa.

alter table client_form_submissions drop constraint if exists client_form_submissions_form_type_check;

alter table client_form_submissions add constraint client_form_submissions_form_type_check check (
  form_type in (
    'new_client', 'onboarding', 'kickoff', 'tech_qa', 'marketing_qa', 'creative',
    'launch', 'launch_kit', 'virtual_card',
    'churn', 'reinstate', 'reinstate_onboarding',
    'landing_page'
  )
);
