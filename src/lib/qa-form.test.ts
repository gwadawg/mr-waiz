import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { creativeApexFunnelLink } from '@/lib/creative-qa-links';
import {
  emptyQaFormDraft,
  formatQaClickUpComment,
  getFirstIncompleteQaItemKey,
  getQaFormConfig,
  isQaChecklistComplete,
  isQaCompleteForCycle,
  isQaLane,
  isQaLifecycle,
  qaDraftFromSubmitBody,
  qaDraftToResponses,
  resolveQaClickUpFieldKey,
  sealCreativeFunnelLinks,
  emptyMediaQaDraft,
  formatMediaQaClickUpComment,
  MEDIA_QA_ITEMS,
  MEDIA_QA_VERSION,
  mediaBuyingQaApplies,
  mediaQaToResponses,
  normalizeAdAccountUrl,
  validateMediaQaDraft,
  QA_FINAL_CONFIRMATION,
  QA_SKELETON_VERSION,
  type QaLane,
} from '@/lib/qa-form';

function completeDraft(lane: QaLane) {
  const config = getQaFormConfig(lane);
  const draft = emptyQaFormDraft(config, 'christian@waiz.media');
  for (const item of config.items) draft.checklist[item.key] = true;
  draft.final_confirmation = QA_FINAL_CONFIRMATION;
  draft.evidence = 'https://example.com/evidence';
  return { config, draft };
}

describe('qa-form', () => {
  it('keeps shared lanes, not per-client form definitions', () => {
    assert.equal(isQaLane('tech_setup'), true);
    assert.equal(isQaLane('media_buying'), true);
    assert.equal(isQaLane('creative'), true);
    assert.equal(isQaLane('funnel'), false);
    assert.equal(getQaFormConfig('tech_setup').formType, 'tech_qa');
    assert.equal(getQaFormConfig('media_buying').formType, 'marketing_qa');
    assert.equal(getQaFormConfig('creative').formType, 'creative');
    assert.equal(getQaFormConfig('tech_setup').clickupFieldKey, 'tech_qa');
    assert.equal(getQaFormConfig('media_buying').clickupFieldKey, 'marketing_qa');
    assert.equal(getQaFormConfig('creative').clickupFieldKey, null);
    assert.deepEqual(
      getQaFormConfig('media_buying').items.map(item => item.label),
      [
        'Ad account, page, pixel, and required access reviewed',
        'Funnel link is present, opens correctly, and matches the intended offer',
        'Campaign/ad set structure is prepared for launch review',
        'Creative, copy, naming, and compliance language received a launch-readiness pass',
        'No unresolved marketing blocker remains for launch review',
      ],
    );
  });

  it('is only available during onboarding lifecycles', () => {
    assert.equal(isQaLifecycle('new_account'), true);
    assert.equal(isQaLifecycle('onboarding'), true);
    assert.equal(isQaLifecycle('active'), false);
    assert.equal(isQaLifecycle('churned'), false);
    assert.equal(isQaLifecycle(null), false);
  });

  it('requires every checklist item plus completed-by and QA confirmation', () => {
    const { config, draft } = completeDraft('tech_setup');
    assert.equal(isQaChecklistComplete(draft, config), true);
    assert.equal(getFirstIncompleteQaItemKey(draft, config), null);

    draft.checklist.a2p_status_checked = false;
    assert.equal(isQaChecklistComplete(draft, config), false);
    assert.equal(getFirstIncompleteQaItemKey(draft, config), 'a2p_status_checked');

    draft.checklist.a2p_status_checked = true;
    draft.final_confirmation = 'yes';
    assert.equal(isQaChecklistComplete(draft, config), false);
  });

  it('stores answers in responses JSON, not ClickUp custom fields', () => {
    const { config, draft } = completeDraft('media_buying');
    const responses = qaDraftToResponses(draft, config);
    assert.equal(responses.qa_lane, 'media_buying');
    assert.equal(responses.skeleton_version, QA_SKELETON_VERSION);
    assert.equal(responses.completed_by_label, 'christian@waiz.media');
    assert.equal((responses.checklist as Record<string, boolean>).funnel_link_checked, true);
    assert.equal(responses.evidence, 'https://example.com/evidence');
  });

  it('formats a ClickUp comment with the shared checklist, not a per-client form body', () => {
    const { config, draft } = completeDraft('tech_setup');
    const comment = formatQaClickUpComment({ id: 'client-1', name: 'Acme LO' }, config, draft);
    assert.match(comment, /Tech Setup QA submitted/);
    assert.match(comment, /Mr\. Waiz ID: client-1/);
    assert.match(comment, /qa-skeleton-v0/);
    assert.match(comment, /A2P status checked/);
  });

  it('stores only confirmed creative lines and omits the rest', () => {
    const config = getQaFormConfig('creative');
    const draft = emptyQaFormDraft(config, 'ada@waiz.media');
    draft.checklist.ads_uploaded_to_client_drive = true;
    draft.checklist.offer_and_message_clean = true;
    draft.final_confirmation = QA_FINAL_CONFIRMATION;

    assert.equal(isQaChecklistComplete(draft, config), true);
    assert.deepEqual(
      config.items.filter(item => item.section === 'Creatives').map(item => item.label),
      [
        'Ads uploaded to the client drive',
        'Client name / business name fine line includes the NMLS#',
        'Offer and message make sense and have no typos',
      ],
    );
    assert.deepEqual(
      config.items.filter(item => item.section === 'Funnel').map(item => item.label),
      [
        'Perspective footer has the correct privacy policy and legal notice',
        'Client bio is clean and makes sense',
        'Brand colors align from WM Apex to Perspective',
        'Correct pixel on the Perspective account',
        'HighLevel integration complete',
        'Opt-in language uses the client name',
        'Correct URL on Perspective (DSCR vs retirement experts)',
      ],
    );
    assert.equal(config.links.find(link => link.key === 'apex_funnel_link')?.readOnly, true);
    assert.equal(config.links.find(link => link.key === 'thank_you_link')?.readOnly, true);
    assert.equal(config.links.find(link => link.key === 'perspective_funnel_link')?.readOnly, false);

    const responses = qaDraftToResponses(draft, config);
    const checklist = responses.checklist as Record<string, unknown>;
    assert.equal(responses.qa_lane, 'creative');
    assert.equal(checklist.ads_uploaded_to_client_drive, true);
    assert.equal(checklist.offer_and_message_clean, true);
    assert.equal('fine_line_includes_nmls' in checklist, false);
    assert.equal('perspective_footer_privacy' in checklist, false);
    assert.equal(Object.values(checklist).includes(false), false);
    assert.equal(Object.values(checklist).includes('no'), false);

    const fromPost = qaDraftToResponses(
      qaDraftFromSubmitBody({
        completed_by_label: 'ada@waiz.media',
        final_confirmation: 'qa',
        checklist: {
          ads_uploaded_to_client_drive: true,
          fine_line_includes_nmls: false,
          offer_and_message_clean: 'no',
        },
      }),
      config,
    );
    const posted = fromPost.checklist as Record<string, unknown>;
    assert.equal(posted.ads_uploaded_to_client_drive, true);
    assert.equal('fine_line_includes_nmls' in posted, false);
    assert.equal('offer_and_message_clean' in posted, false);
    assert.equal(isQaChecklistComplete(qaDraftFromSubmitBody({
      completed_by_label: 'ada@waiz.media',
      final_confirmation: 'QA',
      checklist: { ads_uploaded_to_client_drive: true },
    }), config), true);

    const comment = formatQaClickUpComment({ id: 'client-2', name: 'North Star' }, config, draft);
    assert.match(comment, /Creative QA submitted/);
    assert.match(comment, /Ads uploaded to the client drive/);
    assert.match(comment, /Offer and message make sense and have no typos/);
    assert.equal(comment.includes('fine line includes the NMLS#'), false);
    for (const line of comment.split('\n')) {
      if (line.startsWith('✓')) continue;
      assert.equal(/\bno\b/i.test(line), false, line);
    }
  });

  it('keeps funnel links as links and omits a blank thank-you line', () => {
    const config = getQaFormConfig('creative');
    const draft = emptyQaFormDraft(config, 'ada@waiz.media');
    draft.final_confirmation = QA_FINAL_CONFIRMATION;
    draft.links.apex_funnel_link = 'https://evil.example/apex';
    draft.links.thank_you_link = 'https://evil.example/thanks';
    const sealed = sealCreativeFunnelLinks(draft, {
      perspective: 'https://funnel.example/jane',
      apex: 'https://dscrexperts.com/jane-doe/',
      thankYou: null,
    });
    const responses = qaDraftToResponses(sealed, config);
    const links = responses.links as Record<string, string>;
    assert.equal(links.perspective_funnel_link, 'https://funnel.example/jane');
    assert.equal(links.apex_funnel_link, 'https://dscrexperts.com/jane-doe/');
    assert.equal('thank_you_link' in links, false);
    assert.equal(Object.values(links).includes('no'), false);

    const apex = creativeApexFunnelLink([
      {
        id: 'row-1',
        client_id: 'client-1',
        status: 'applied',
        submitted_at: '2026-10-01T00:00:00.000Z',
        responses: { product: 'DSCR', fields: { slug: 'jane-doe' } },
      },
    ]);
    assert.equal(apex, 'https://dscrexperts.com/jane-doe/');
  });

  it('uses creative_qa as the ClickUp field key to add', () => {
    const config = getQaFormConfig('creative');
    assert.equal(resolveQaClickUpFieldKey(config, {}), null);
    assert.equal(resolveQaClickUpFieldKey(config, { tech_qa: { id: 't' }, marketing_qa: { id: 'm' } }), null);
    assert.equal(resolveQaClickUpFieldKey(config, { creative_qa: { id: 'c' } }), 'creative_qa');
    assert.equal(resolveQaClickUpFieldKey(config, { creative: { id: 'c' } }), 'creative');
    assert.equal(
      resolveQaClickUpFieldKey(config, { creative: { id: 'c' }, creative_qa: { id: 'q' } }),
      'creative_qa',
    );
    assert.equal(resolveQaClickUpFieldKey(getQaFormConfig('media_buying'), {}), 'marketing_qa');
  });

  it('treats a reinstate as a new QA cycle', () => {
    const rows = [
      { form_type: 'tech_qa', submitted_at: '2026-01-01T00:00:00.000Z', status: 'applied' },
      { form_type: 'reinstate', submitted_at: '2026-09-01T00:00:00.000Z', status: 'applied' },
    ];
    assert.equal(isQaCompleteForCycle(rows, 'tech_qa'), false);
    assert.equal(
      isQaCompleteForCycle(
        [
          ...rows,
          { form_type: 'tech_qa', submitted_at: '2026-09-02T00:00:00.000Z', status: 'applied' },
        ],
        'tech_qa',
      ),
      true,
    );
    assert.equal(
      isQaCompleteForCycle(
        [{ form_type: 'creative', submitted_at: '2026-09-02T00:00:00.000Z', status: 'applied' }],
        'creative',
      ),
      true,
    );
  });
});

function completeMediaDraft() {
  const draft = emptyMediaQaDraft('buyer@waiz.media', 'adsmanager.facebook.com/adsmanager/manage/campaigns?act=1');
  for (const item of MEDIA_QA_ITEMS) draft.done[item.key] = true;
  draft.final_confirmation = QA_FINAL_CONFIRMATION;
  return draft;
}

describe('media buying qa v1', () => {
  it('hides the form for HE and shows it for leads and call center', () => {
    assert.equal(mediaBuyingQaApplies('CALL_CENTER'), false);
    assert.equal(mediaBuyingQaApplies('HE'), false);
    assert.equal(mediaBuyingQaApplies('RM'), true);
    assert.equal(mediaBuyingQaApplies('DSCR'), true);
    assert.equal(mediaBuyingQaApplies(''), true);
    assert.equal(mediaBuyingQaApplies(null), true);
  });

  it('requires the ad account link unless it does not apply', () => {
    const draft = completeMediaDraft();
    assert.equal(validateMediaQaDraft(draft), null);
    assert.equal(normalizeAdAccountUrl('adsmanager.facebook.com/adsmanager'), 'https://adsmanager.facebook.com/adsmanager');
    assert.equal(normalizeAdAccountUrl('not a url'), null);

    draft.ad_account_url = '';
    assert.match(validateMediaQaDraft(draft) ?? '', /ad account link/i);
    draft.ad_account_skipped = true;
    assert.equal(validateMediaQaDraft(draft), null);
  });

  it('requires Facebook page, UTM, and MAKE, and lets other lines be skipped', () => {
    const draft = completeMediaDraft();
    draft.done.fb_profile_pic = false;
    assert.match(validateMediaQaDraft(draft) ?? '', /Profile picture/);
    draft.skipped.fb_profile_pic = true;
    assert.match(validateMediaQaDraft(draft) ?? '', /Profile picture/);

    draft.done.fb_profile_pic = true;
    draft.skipped.fb_profile_pic = false;
    draft.done.utm_placed = false;
    assert.match(validateMediaQaDraft(draft) ?? '', /UTM/);
    draft.done.utm_placed = true;
    draft.done.make_subaccount_name = false;
    assert.match(validateMediaQaDraft(draft) ?? '', /MAKE/);

    draft.done.make_subaccount_name = true;
    draft.done.dummy_account = false;
    assert.match(validateMediaQaDraft(draft) ?? '', /does not apply/i);
    draft.skipped.dummy_account = true;
    assert.equal(validateMediaQaDraft(draft), null);
  });

  it('stores done checks and skipped keys, not a No for a skipped line', () => {
    const draft = completeMediaDraft();
    draft.done.dummy_account = false;
    draft.skipped.dummy_account = true;
    draft.ad_account_skipped = true;
    const responses = mediaQaToResponses(draft);
    assert.equal(responses.skeleton_version, MEDIA_QA_VERSION);
    assert.equal(responses.ad_account_url, null);
    assert.equal(responses.ad_account_skipped, true);
    const checklist = responses.checklist as Record<string, boolean>;
    assert.equal(checklist.dummy_account, undefined);
    assert.equal(checklist.utm_placed, true);
    assert.deepEqual(responses.skipped, ['dummy_account']);
  });

  it('writes a ClickUp comment that names the checks and the roster link', () => {
    const draft = completeMediaDraft();
    const comment = formatMediaQaClickUpComment({ id: 'client-1', name: 'Acme LO' }, draft);
    assert.match(comment, /Media Buying QA submitted/);
    assert.match(comment, /media-buying-qa-v1/);
    assert.match(comment, /https:\/\/adsmanager\.facebook\.com/);
    assert.match(comment, /Dummy account setup with a \$5 budget/);
    assert.match(comment, /Profile picture is up/);
  });
});
