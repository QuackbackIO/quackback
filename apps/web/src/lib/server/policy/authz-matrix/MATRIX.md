# Authorization matrix (generated — do not edit by hand)

Regenerate with `bunx vitest run apps/web/src/lib/server/policy/authz-matrix -u`.
A diff here means a gate, a role preset, or the set of surfaces changed — review it as an access-control change.

## 1. Permission reach by role profile

Profiles: **Owner** = admin class + an admin-owned full API key (scoped keys hold the subset their scopes map to); **Manager** = member class + member OAuth grant; **None** = portal user + every widget class (holds no teammate permission).

| Permission | Category | Owner | Manager |
| --- | --- | :---: | :---: |
| settings.manage | workspace | ✓ | · |
| settings.branding | workspace | ✓ | · |
| settings.moderation | workspace | ✓ | · |
| settings.notifications | workspace | ✓ | · |
| settings.custom_domain | workspace | ✓ | · |
| billing.manage | workspace | ✓ | · |
| role.manage | workspace | ✓ | · |
| api_key.manage | workspace | ✓ | · |
| webhook.view | workspace | ✓ | · |
| webhook.manage | workspace | ✓ | · |
| auth.manage | workspace | ✓ | · |
| audit.view | workspace | ✓ | · |
| custom_field.manage | workspace | ✓ | · |
| member.view | members | ✓ | ✓ |
| member.manage | members | ✓ | · |
| people.view | people | ✓ | ✓ |
| people.manage | people | ✓ | ✓ |
| company.view | company | ✓ | ✓ |
| company.manage | company | ✓ | ✓ |
| segment.view | audience | ✓ | ✓ |
| segment.manage | audience | ✓ | ✓ |
| user_attribute.view | audience | ✓ | ✓ |
| user_attribute.manage | audience | ✓ | ✓ |
| post.view_private | feedback | ✓ | ✓ |
| post.create | feedback | ✓ | ✓ |
| post.edit | feedback | ✓ | ✓ |
| post.delete | feedback | ✓ | ✓ |
| post.set_status | feedback | ✓ | ✓ |
| post.set_board | feedback | ✓ | ✓ |
| post.set_tags | feedback | ✓ | ✓ |
| post.set_owner | feedback | ✓ | ✓ |
| post.set_author | feedback | ✓ | ✓ |
| post.merge | feedback | ✓ | ✓ |
| post.export | feedback | ✓ | ✓ |
| post.set_pinned | feedback | ✓ | ✓ |
| post.set_eta | feedback | ✓ | ✓ |
| post.approve | feedback | ✓ | ✓ |
| post.vote_on_behalf | feedback | ✓ | ✓ |
| comment.moderate | feedback | ✓ | ✓ |
| comment.edit | feedback | ✓ | ✓ |
| comment.pin | feedback | ✓ | ✓ |
| comment.view_private | feedback | ✓ | ✓ |
| board.manage | feedback | ✓ | ✓ |
| roadmap.manage | feedback | ✓ | ✓ |
| status.view | feedback | ✓ | ✓ |
| status.manage | feedback | ✓ | ✓ |
| tag.view | feedback | ✓ | ✓ |
| tag.manage | feedback | ✓ | ✓ |
| suggestion.view | feedback | ✓ | ✓ |
| suggestion.manage | feedback | ✓ | ✓ |
| prioritization.manage | feedback | ✓ | ✓ |
| changelog.view_draft | changelog | ✓ | ✓ |
| changelog.manage | changelog | ✓ | ✓ |
| help_center.manage | help_center | ✓ | ✓ |
| survey.view | survey | ✓ | ✓ |
| survey.manage | survey | ✓ | ✓ |
| conversation.view | conversation | ✓ | ✓ |
| conversation.view_all | conversation | ✓ | ✓ |
| conversation.reply | conversation | ✓ | ✓ |
| conversation.note | conversation | ✓ | ✓ |
| conversation.assign | conversation | ✓ | ✓ |
| conversation.manage | conversation | ✓ | ✓ |
| conversation.set_status | conversation | ✓ | ✓ |
| conversation.set_tags | conversation | ✓ | ✓ |
| conversation.manage_tags | conversation | ✓ | ✓ |
| conversation.manage_views | conversation | ✓ | ✓ |
| conversation.set_attributes | conversation | ✓ | ✓ |
| analytics.view | analytics | ✓ | ✓ |
| integration.view | integration | ✓ | ✓ |
| integration.manage | integration | ✓ | · |
| ticket.view | support | ✓ | ✓ |
| ticket.view_all | support | ✓ | ✓ |
| ticket.reply | support | ✓ | ✓ |
| ticket.note | support | ✓ | ✓ |
| ticket.assign | support | ✓ | ✓ |
| ticket.set_status | support | ✓ | ✓ |
| ticket.create | support | ✓ | ✓ |
| ticket.manage_types | support | ✓ | ✓ |
| sla.manage | support | ✓ | · |
| routing.manage | support | ✓ | · |
| team.manage | support | ✓ | · |
| workflow.manage | support | ✓ | · |
| channel_account.manage | support | ✓ | · |

## 2. Surfaces and their enforced authorization

### Server functions (`requireAuth`) — 424 surfaces

| Surface | Enforces |
| --- | --- |
| `lib/server/functions/activity.ts`::fetchActivityForPost | post.view_private |
| `lib/server/functions/admin-reset-two-factor.ts`::adminResetTwoFactorFn | auth.manage |
| `lib/server/functions/admin.ts`::fetchInboxPosts | post.view_private |
| `lib/server/functions/admin.ts`::fetchBoardsList | board.manage |
| `lib/server/functions/admin.ts`::fetchTagsList | tag.view |
| `lib/server/functions/admin.ts`::fetchStatusesList | status.view |
| `lib/server/functions/admin.ts`::fetchTeamMembers | member.view |
| `lib/server/functions/admin.ts`::searchPeopleFn | people.view |
| `lib/server/functions/admin.ts`::updateMemberRoleFn | member.manage |
| `lib/server/functions/admin.ts`::forceSignOutUserFn | auth.manage |
| `lib/server/functions/admin.ts`::removeTeamMemberFn | member.manage |
| `lib/server/functions/admin.ts`::fetchOnboardingStatus | member.view |
| `lib/server/functions/admin.ts`::fetchBoardsForSettings | board.manage |
| `lib/server/functions/admin.ts`::fetchIntegrationsList | integration.view |
| `lib/server/functions/admin.ts`::fetchIntegrationByType | integration.manage |
| `lib/server/functions/admin.ts`::listPortalUsersFn | people.view |
| `lib/server/functions/admin.ts`::getPortalUserFn | people.view |
| `lib/server/functions/admin.ts`::updatePortalUserFn | people.manage |
| `lib/server/functions/admin.ts`::createPortalUserFn | people.manage |
| `lib/server/functions/admin.ts`::deletePortalUserFn | people.manage |
| `lib/server/functions/admin.ts`::sendInvitationFn | member.manage |
| `lib/server/functions/admin.ts`::cancelInvitationFn | member.manage |
| `lib/server/functions/admin.ts`::resendInvitationFn | member.manage |
| `lib/server/functions/admin.ts`::fetchSegmentAttributeValuesFn | segment.view |
| `lib/server/functions/admin.ts`::listSegmentsFn | segment.view |
| `lib/server/functions/admin.ts`::createSegmentFn | segment.manage |
| `lib/server/functions/admin.ts`::updateSegmentFn | segment.manage |
| `lib/server/functions/admin.ts`::deleteSegmentFn | segment.manage |
| `lib/server/functions/admin.ts`::assignUsersToSegmentFn | segment.manage |
| `lib/server/functions/admin.ts`::removeUsersFromSegmentFn | segment.manage |
| `lib/server/functions/admin.ts`::evaluateSegmentFn | segment.manage |
| `lib/server/functions/admin.ts`::evaluateAllSegmentsFn | segment.manage |
| `lib/server/functions/admin.ts`::listUserAttributesFn | user_attribute.view |
| `lib/server/functions/admin.ts`::createUserAttributeFn | user_attribute.manage |
| `lib/server/functions/admin.ts`::updateUserAttributeFn | user_attribute.manage |
| `lib/server/functions/admin.ts`::deleteUserAttributeFn | user_attribute.manage |
| `lib/server/functions/analytics.ts`::getAnalyticsData | analytics.view |
| `lib/server/functions/api-keys.ts`::fetchApiKeys | api_key.manage |
| `lib/server/functions/api-keys.ts`::fetchApiKey | api_key.manage |
| `lib/server/functions/api-keys.ts`::createApiKeyFn | api_key.manage |
| `lib/server/functions/api-keys.ts`::updateApiKeyFn | api_key.manage |
| `lib/server/functions/api-keys.ts`::rotateApiKeyFn | api_key.manage |
| `lib/server/functions/api-keys.ts`::revokeApiKeyFn | api_key.manage |
| `lib/server/functions/audit-log.ts`::listAuditEventsFn | audit.view |
| `lib/server/functions/auth-provider-credentials.ts`::saveAuthProviderCredentialsFn | auth.manage |
| `lib/server/functions/auth-provider-credentials.ts`::deleteAuthProviderCredentialsFn | auth.manage |
| `lib/server/functions/auth-provider-credentials.ts`::fetchAuthProviderCredentialsMaskedFn | auth.manage |
| `lib/server/functions/auth-provider-credentials.ts`::fetchAuthProviderStatusFn | auth.manage |
| `lib/server/functions/blocking.ts`::getPersonBlockStatusFn | people.view |
| `lib/server/functions/blocking.ts`::blockPersonFn | people.manage |
| `lib/server/functions/blocking.ts`::unblockPersonFn | people.manage |
| `lib/server/functions/boards.ts`::fetchBoardsFn | board.manage |
| `lib/server/functions/boards.ts`::fetchBoardFn | board.manage |
| `lib/server/functions/boards.ts`::createBoardFn | board.manage |
| `lib/server/functions/boards.ts`::updateBoardFn | board.manage |
| `lib/server/functions/boards.ts`::deleteBoardFn | board.manage |
| `lib/server/functions/boards.ts`::createBoardsBatchFn | board.manage |
| `lib/server/functions/boards.ts`::updateBoardAccessFn | board.manage |
| `lib/server/functions/changelog.ts`::createChangelogFn | changelog.manage |
| `lib/server/functions/changelog.ts`::updateChangelogFn | changelog.manage |
| `lib/server/functions/changelog.ts`::deleteChangelogFn | changelog.manage |
| `lib/server/functions/changelog.ts`::getChangelogFn | changelog.view_draft |
| `lib/server/functions/changelog.ts`::listChangelogsFn | changelog.view_draft |
| `lib/server/functions/changelog.ts`::searchShippedPostsFn | changelog.manage |
| `lib/server/functions/channel-accounts.ts`::getEmailChannelConfigFn | channel_account.manage |
| `lib/server/functions/channel-accounts.ts`::createInboundRouteFn | channel_account.manage |
| `lib/server/functions/channel-accounts.ts`::createSendingAddressFn | channel_account.manage |
| `lib/server/functions/channel-accounts.ts`::createSendingDomainFn | channel_account.manage |
| `lib/server/functions/channel-accounts.ts`::verifySendingDomainFn | channel_account.manage |
| `lib/server/functions/channel-accounts.ts`::deleteChannelAccountFn | channel_account.manage |
| `lib/server/functions/comments.ts`::createCommentFn | END_USER (any authenticated) |
| `lib/server/functions/comments.ts`::addReactionFn | END_USER (any authenticated) |
| `lib/server/functions/comments.ts`::removeReactionFn | END_USER (any authenticated) |
| `lib/server/functions/comments.ts`::userEditCommentFn | END_USER (any authenticated) |
| `lib/server/functions/comments.ts`::userDeleteCommentFn | END_USER (any authenticated) |
| `lib/server/functions/comments.ts`::restoreCommentFn | comment.moderate |
| `lib/server/functions/comments.ts`::pinCommentFn | comment.pin |
| `lib/server/functions/comments.ts`::unpinCommentFn | comment.pin |
| `lib/server/functions/companies.ts`::listCompaniesFn | company.view |
| `lib/server/functions/companies.ts`::getCompanyFn | company.view |
| `lib/server/functions/companies.ts`::getCompanyForPrincipalFn | company.view |
| `lib/server/functions/companies.ts`::createCompanyFn | company.manage |
| `lib/server/functions/companies.ts`::updateCompanyFn | company.manage |
| `lib/server/functions/companies.ts`::deleteCompanyFn | company.manage |
| `lib/server/functions/companies.ts`::attachPrincipalToCompanyFn | company.manage |
| `lib/server/functions/companies.ts`::detachPrincipalFromCompanyFn | company.manage |
| `lib/server/functions/conversation-attributes.ts`::listConversationAttributesFn | conversation.view |
| `lib/server/functions/conversation-attributes.ts`::createConversationAttributeFn | conversation.manage |
| `lib/server/functions/conversation-attributes.ts`::updateConversationAttributeFn | conversation.manage |
| `lib/server/functions/conversation-attributes.ts`::archiveConversationAttributeFn | conversation.manage |
| `lib/server/functions/conversation-attributes.ts`::restoreConversationAttributeFn | conversation.manage |
| `lib/server/functions/conversation-attributes.ts`::setConversationAttributeValueFn | conversation.set_attributes |
| `lib/server/functions/conversation-segments.ts`::fetchInboxSegmentsWithCountsFn | conversation.view |
| `lib/server/functions/conversation-tags.ts`::fetchConversationTagsFn | conversation.view |
| `lib/server/functions/conversation-tags.ts`::fetchConversationTagsWithCountsFn | conversation.view |
| `lib/server/functions/conversation-tags.ts`::createConversationTagFn | conversation.manage_tags |
| `lib/server/functions/conversation-tags.ts`::updateConversationTagFn | conversation.manage_tags |
| `lib/server/functions/conversation-tags.ts`::deleteConversationTagFn | conversation.manage_tags |
| `lib/server/functions/conversation-tags.ts`::listConversationTagsForSettingsFn | conversation.manage_tags |
| `lib/server/functions/conversation-tags.ts`::restoreConversationTagFn | conversation.manage_tags |
| `lib/server/functions/conversation-tags.ts`::hardDeleteConversationTagFn | conversation.manage_tags |
| `lib/server/functions/conversation-tags.ts`::addConversationTagFn | conversation.set_tags |
| `lib/server/functions/conversation-tags.ts`::removeConversationTagFn | conversation.set_tags |
| `lib/server/functions/conversation-views.ts`::listConversationViewsFn | conversation.view |
| `lib/server/functions/conversation-views.ts`::createConversationViewFn | conversation.manage_views |
| `lib/server/functions/conversation-views.ts`::updateConversationViewFn | conversation.manage_views |
| `lib/server/functions/conversation-views.ts`::deleteConversationViewFn | conversation.manage_views |
| `lib/server/functions/conversation-views.ts`::pinConversationViewFn | conversation.view |
| `lib/server/functions/conversation-views.ts`::unpinConversationViewFn | conversation.view |
| `lib/server/functions/conversation.ts`::sendConversationMessageFn | END_USER (any authenticated) |
| `lib/server/functions/conversation.ts`::listConversationMessagesFn | END_USER (any authenticated) |
| `lib/server/functions/conversation.ts`::exportConversationTranscriptFn | conversation.view |
| `lib/server/functions/conversation.ts`::exportConversationTranscriptFn | TEAM-ONLY (~conversation.view) |
| `lib/server/functions/conversation.ts`::markConversationReadFn | END_USER (any authenticated) |
| `lib/server/functions/conversation.ts`::sendConversationTypingFn | END_USER (any authenticated) |
| `lib/server/functions/conversation.ts`::submitCsatFn | END_USER (any authenticated) |
| `lib/server/functions/conversation.ts`::setAgentAvailabilityFn | conversation.view |
| `lib/server/functions/conversation.ts`::mintConversationStreamTokenFn | END_USER (any authenticated) |
| `lib/server/functions/conversation.ts`::deleteConversationMessageFn | END_USER (any authenticated) |
| `lib/server/functions/conversation.ts`::listConversationsFn | conversation.view |
| `lib/server/functions/conversation.ts`::fetchAssistantInboxCountsFn | conversation.view |
| `lib/server/functions/conversation.ts`::getConversationAssistantActivityFn | conversation.view |
| `lib/server/functions/conversation.ts`::listConversationsForUserFn | conversation.view |
| `lib/server/functions/conversation.ts`::getConversationFn | conversation.view |
| `lib/server/functions/conversation.ts`::sendAgentMessageFn | conversation.reply |
| `lib/server/functions/conversation.ts`::startAgentConversationFn | conversation.reply |
| `lib/server/functions/conversation.ts`::addConversationNoteFn | conversation.note |
| `lib/server/functions/conversation.ts`::createPostFromConversationFn | post.create |
| `lib/server/functions/conversation.ts`::captureVisitorContactEmailFn | conversation.manage |
| `lib/server/functions/conversation.ts`::sharePostFn | conversation.reply |
| `lib/server/functions/conversation.ts`::setConversationStatusFn | conversation.set_status |
| `lib/server/functions/conversation.ts`::snoozeConversationFn | conversation.set_status |
| `lib/server/functions/conversation.ts`::endConversationFn | conversation.set_status |
| `lib/server/functions/conversation.ts`::assignConversationFn | conversation.assign |
| `lib/server/functions/conversation.ts`::setConversationPriorityFn | conversation.set_status |
| `lib/server/functions/conversation.ts`::addMessageReactionFn | conversation.note |
| `lib/server/functions/conversation.ts`::removeMessageReactionFn | conversation.note |
| `lib/server/functions/conversation.ts`::setMessageFlagFn | conversation.note |
| `lib/server/functions/conversation.ts`::markConversationUnreadFromMessageFn | conversation.view |
| `lib/server/functions/conversation.ts`::bulkUpdateConversationsFn | DYNAMIC (conversation.assign | conversation.set_status) |
| `lib/server/functions/conversation.ts`::listFlaggedMessagesFn | conversation.view |
| `lib/server/functions/conversation.ts`::getLinkedPostsForConversationFn | conversation.view |
| `lib/server/functions/conversation.ts`::getLinkedConversationsForPostFn | conversation.view |
| `lib/server/functions/external-statuses.ts`::fetchExternalStatusesFn | integration.manage |
| `lib/server/functions/feature-flags.ts`::updateFeatureFlagsFn | settings.manage |
| `lib/server/functions/feedback.ts`::fetchSuggestions | suggestion.view |
| `lib/server/functions/feedback.ts`::fetchIncomingSuggestionCount | suggestion.view |
| `lib/server/functions/feedback.ts`::fetchFeedbackSources | integration.view |
| `lib/server/functions/feedback.ts`::acceptSuggestionFn | suggestion.manage |
| `lib/server/functions/feedback.ts`::dismissSuggestionFn | suggestion.manage |
| `lib/server/functions/feedback.ts`::restoreSuggestionFn | suggestion.manage |
| `lib/server/functions/feedback.ts`::retryFailedItemFn | suggestion.manage |
| `lib/server/functions/feedback.ts`::retryAllFailedItemsFn | suggestion.manage |
| `lib/server/functions/feedback.ts`::createFeedbackSourceFn | integration.manage |
| `lib/server/functions/feedback.ts`::updateFeedbackSourceFn | integration.manage |
| `lib/server/functions/feedback.ts`::deleteFeedbackSourceFn | integration.manage |
| `lib/server/functions/help-center-settings.ts`::getHelpCenterConfigFn | help_center.manage |
| `lib/server/functions/help-center-settings.ts`::updateHelpCenterConfigFn | help_center.manage |
| `lib/server/functions/help-center-settings.ts`::updateHelpCenterSeoFn | help_center.manage |
| `lib/server/functions/help-center.ts`::listCategoriesFn | help_center.manage |
| `lib/server/functions/help-center.ts`::getCategoryFn | help_center.manage |
| `lib/server/functions/help-center.ts`::createCategoryFn | help_center.manage |
| `lib/server/functions/help-center.ts`::updateCategoryFn | help_center.manage |
| `lib/server/functions/help-center.ts`::deleteCategoryFn | help_center.manage |
| `lib/server/functions/help-center.ts`::listArticlesFn | help_center.manage |
| `lib/server/functions/help-center.ts`::restoreCategoryFn | help_center.manage |
| `lib/server/functions/help-center.ts`::restoreArticleFn | help_center.manage |
| `lib/server/functions/help-center.ts`::getArticleFn | help_center.manage |
| `lib/server/functions/help-center.ts`::createArticleFn | help_center.manage |
| `lib/server/functions/help-center.ts`::updateArticleFn | help_center.manage |
| `lib/server/functions/help-center.ts`::publishArticleFn | help_center.manage |
| `lib/server/functions/help-center.ts`::unpublishArticleFn | help_center.manage |
| `lib/server/functions/help-center.ts`::deleteArticleFn | help_center.manage |
| `lib/server/functions/integrations.ts`::updateIntegrationFn | integration.manage |
| `lib/server/functions/integrations.ts`::deleteIntegrationFn | integration.manage |
| `lib/server/functions/integrations.ts`::addNotificationChannelFn | integration.manage |
| `lib/server/functions/integrations.ts`::updateNotificationChannelFn | integration.manage |
| `lib/server/functions/integrations.ts`::removeNotificationChannelFn | integration.manage |
| `lib/server/functions/integrations.ts`::addMonitoredChannelFn | integration.manage |
| `lib/server/functions/integrations.ts`::updateMonitoredChannelFn | integration.manage |
| `lib/server/functions/integrations.ts`::removeMonitoredChannelFn | integration.manage |
| `lib/server/functions/link-preview.ts`::unfurlLinkFn | END_USER (any authenticated) |
| `lib/server/functions/macros.ts`::listMacrosFn | conversation.reply |
| `lib/server/functions/macros.ts`::createMacroFn | conversation.manage |
| `lib/server/functions/macros.ts`::updateMacroFn | conversation.manage |
| `lib/server/functions/macros.ts`::deleteMacroFn | conversation.manage |
| `lib/server/functions/macros.ts`::applyMacroFn | conversation.reply |
| `lib/server/functions/merge-suggestions.ts`::getMergeSuggestionsForPostFn | post.view_private |
| `lib/server/functions/merge-suggestions.ts`::fetchMergeSuggestionSummaryFn | post.view_private |
| `lib/server/functions/merge-suggestions.ts`::fetchMergeSuggestionCountsForPostsFn | post.view_private |
| `lib/server/functions/moderation.ts`::requireTeamAuth | post.approve |
| `lib/server/functions/moderation.ts`::listPendingPostsFn | post.approve |
| `lib/server/functions/moderation.ts`::listPendingCommentsFn | post.approve |
| `lib/server/functions/moderation.ts`::approvePostFn | post.approve |
| `lib/server/functions/moderation.ts`::approveCommentFn | post.approve |
| `lib/server/functions/moderation.ts`::rejectCommentFn | post.approve |
| `lib/server/functions/moderation.ts`::rejectPostFn | post.approve |
| `lib/server/functions/moderation.ts`::getModerationStatus | post.approve |
| `lib/server/functions/notifications.ts`::getNotificationsFn | END_USER (any authenticated) |
| `lib/server/functions/notifications.ts`::getUnreadCountFn | END_USER (any authenticated) |
| `lib/server/functions/notifications.ts`::markNotificationAsReadFn | END_USER (any authenticated) |
| `lib/server/functions/notifications.ts`::markAllNotificationsAsReadFn | END_USER (any authenticated) |
| `lib/server/functions/notifications.ts`::archiveNotificationFn | END_USER (any authenticated) |
| `lib/server/functions/onboarding.ts`::setupWorkspaceFn | ADMIN-ONLY |
| `lib/server/functions/plan-notice.ts`::getPlanNotice | member.view |
| `lib/server/functions/platform-credentials.ts`::savePlatformCredentialsFn | integration.manage |
| `lib/server/functions/platform-credentials.ts`::deletePlatformCredentialsFn | integration.manage |
| `lib/server/functions/platform-credentials.ts`::fetchPlatformCredentialsMaskedFn | integration.manage |
| `lib/server/functions/portal-access.ts`::updatePortalAccessFn | settings.manage |
| `lib/server/functions/portal-invites.ts`::sendPortalInviteFn | settings.manage |
| `lib/server/functions/portal-invites.ts`::cancelPortalInviteFn | settings.manage |
| `lib/server/functions/portal-invites.ts`::resendPortalInviteFn | settings.manage |
| `lib/server/functions/portal-invites.ts`::fetchPortalInvitesFn | settings.manage |
| `lib/server/functions/portal-invites.ts`::getPortalInviteLinkFn | settings.manage |
| `lib/server/functions/portal.ts`::fetchSubscriptionStatus | END_USER (any authenticated) |
| `lib/server/functions/post-merge.ts`::mergePostFn | post.merge |
| `lib/server/functions/post-merge.ts`::unmergePostFn | post.merge |
| `lib/server/functions/post-merge.ts`::getMergedPostsFn | post.view_private |
| `lib/server/functions/post-merge.ts`::fetchMergePreviewFn | post.view_private |
| `lib/server/functions/post-tags.ts`::fetchTags | tag.view |
| `lib/server/functions/post-tags.ts`::fetchTag | tag.view |
| `lib/server/functions/post-tags.ts`::createPostTagFn | tag.manage |
| `lib/server/functions/post-tags.ts`::updatePostTagFn | tag.manage |
| `lib/server/functions/post-tags.ts`::deletePostTagFn | tag.manage |
| `lib/server/functions/posts.ts`::fetchInboxPostsForAdmin | post.view_private |
| `lib/server/functions/posts.ts`::fetchPostWithDetails | post.view_private |
| `lib/server/functions/posts.ts`::fetchPostVotersFn | post.view_private |
| `lib/server/functions/posts.ts`::fetchPostFeedbackSourceFn | post.view_private |
| `lib/server/functions/posts.ts`::createPostFn | post.create |
| `lib/server/functions/posts.ts`::updatePostFn | post.edit |
| `lib/server/functions/posts.ts`::setPostOwnerFn | post.set_owner |
| `lib/server/functions/posts.ts`::setPostEtaFn | post.set_eta |
| `lib/server/functions/posts.ts`::deletePostFn | post.delete |
| `lib/server/functions/posts.ts`::fetchPostExternalLinksFn | post.view_private |
| `lib/server/functions/posts.ts`::changePostStatusFn | post.set_status |
| `lib/server/functions/posts.ts`::changePostBoardFn | post.set_board |
| `lib/server/functions/posts.ts`::restorePostFn | post.delete |
| `lib/server/functions/posts.ts`::updatePostTagsFn | post.set_tags |
| `lib/server/functions/posts.ts`::proxyVoteFn | post.vote_on_behalf |
| `lib/server/functions/posts.ts`::removeVoteFn | post.vote_on_behalf |
| `lib/server/functions/posts.ts`::toggleCommentsLockFn | post.edit |
| `lib/server/functions/public-posts.ts`::userEditPostFn | END_USER (any authenticated) |
| `lib/server/functions/public-posts.ts`::userDeletePostFn | END_USER (any authenticated) |
| `lib/server/functions/public-posts.ts`::toggleVoteFn | END_USER (any authenticated) |
| `lib/server/functions/public-posts.ts`::createPublicPostFn | END_USER (any authenticated) |
| `lib/server/functions/recovery-codes.ts`::generateRecoveryCodesFn | auth.manage |
| `lib/server/functions/recovery-codes.ts`::listRecoveryCodesFn | auth.manage |
| `lib/server/functions/roadmaps.ts`::fetchRoadmaps | roadmap.manage |
| `lib/server/functions/roadmaps.ts`::fetchRoadmap | roadmap.manage |
| `lib/server/functions/roadmaps.ts`::createRoadmapFn | roadmap.manage |
| `lib/server/functions/roadmaps.ts`::updateRoadmapFn | roadmap.manage |
| `lib/server/functions/roadmaps.ts`::deleteRoadmapFn | roadmap.manage |
| `lib/server/functions/roadmaps.ts`::addPostToRoadmapFn | roadmap.manage |
| `lib/server/functions/roadmaps.ts`::removePostFromRoadmapFn | roadmap.manage |
| `lib/server/functions/roadmaps.ts`::reorderRoadmapsFn | roadmap.manage |
| `lib/server/functions/roadmaps.ts`::getRoadmapPostsFn | roadmap.manage |
| `lib/server/functions/settings.ts`::fetchPortalConfig | settings.manage |
| `lib/server/functions/settings.ts`::fetchAuthConfigFn | auth.manage |
| `lib/server/functions/settings.ts`::fetchDeveloperConfig | settings.manage |
| `lib/server/functions/settings.ts`::fetchTeamMembersAndInvitations | member.view |
| `lib/server/functions/settings.ts`::updateThemeFn | settings.branding |
| `lib/server/functions/settings.ts`::updatePortalConfigFn | settings.manage |
| `lib/server/functions/settings.ts`::updateAuthConfigFn | auth.manage |
| `lib/server/functions/settings.ts`::saveLogoKeyFn | settings.branding |
| `lib/server/functions/settings.ts`::deleteLogoFn | settings.branding |
| `lib/server/functions/settings.ts`::saveHeaderLogoKeyFn | settings.branding |
| `lib/server/functions/settings.ts`::deleteHeaderLogoFn | settings.branding |
| `lib/server/functions/settings.ts`::updateHeaderDisplayModeFn | settings.branding |
| `lib/server/functions/settings.ts`::updateHeaderDisplayNameFn | settings.branding |
| `lib/server/functions/settings.ts`::updateWorkspaceNameFn | settings.branding |
| `lib/server/functions/settings.ts`::updateCustomCssFn | settings.branding |
| `lib/server/functions/settings.ts`::updateDeveloperConfigFn | settings.manage |
| `lib/server/functions/settings.ts`::fetchWidgetConfig | settings.manage |
| `lib/server/functions/settings.ts`::fetchWidgetSecret | settings.manage |
| `lib/server/functions/settings.ts`::updateWidgetConfigFn | settings.manage |
| `lib/server/functions/settings.ts`::saveWidgetHeroImageKeyFn | settings.manage |
| `lib/server/functions/settings.ts`::deleteWidgetHeroImageFn | settings.manage |
| `lib/server/functions/settings.ts`::regenerateWidgetSecretFn | settings.manage |
| `lib/server/functions/settings.ts`::fetchOfficeHoursFn | settings.manage |
| `lib/server/functions/settings.ts`::updateOfficeHoursFn | settings.manage |
| `lib/server/functions/settings.ts`::getEmailChannelStatusFn | settings.manage |
| `lib/server/functions/settings.ts`::updateModerationDefaultFn | settings.moderation |
| `lib/server/functions/sla.ts`::listSlaPoliciesFn | sla.manage |
| `lib/server/functions/sla.ts`::listSlaPolicyOptionsFn | conversation.view |
| `lib/server/functions/sla.ts`::listSlaScheduleOptionsFn | sla.manage |
| `lib/server/functions/sla.ts`::createSlaPolicyFn | sla.manage |
| `lib/server/functions/sla.ts`::updateSlaPolicyFn | sla.manage |
| `lib/server/functions/sla.ts`::archiveSlaPolicyFn | sla.manage |
| `lib/server/functions/sla.ts`::restoreSlaPolicyFn | sla.manage |
| `lib/server/functions/sla.ts`::removeConversationSlaFn | conversation.set_status |
| `lib/server/functions/sso-test.ts`::startSsoTestFn | auth.manage |
| `lib/server/functions/sso-test.ts`::getSsoTestResultFn | auth.manage |
| `lib/server/functions/sso.ts`::clearSsoClientSecretFn | auth.manage |
| `lib/server/functions/sso.ts`::removeVerifiedDomainFn | auth.manage |
| `lib/server/functions/sso.ts`::getVerifiedDomainsFn | auth.manage |
| `lib/server/functions/sso.ts`::listIdentityProvidersFn | auth.manage |
| `lib/server/functions/sso.ts`::upsertIdentityProviderFn | auth.manage |
| `lib/server/functions/sso.ts`::deleteIdentityProviderFn | auth.manage |
| `lib/server/functions/sso.ts`::setProviderCredentialsFn | auth.manage |
| `lib/server/functions/sso.ts`::addProviderDomainFn | auth.manage |
| `lib/server/functions/sso.ts`::verifyProviderDomainFn | auth.manage |
| `lib/server/functions/sso.ts`::setDomainEnforcedFn | auth.manage |
| `lib/server/functions/status-sync.ts`::enableStatusSyncFn | integration.manage |
| `lib/server/functions/status-sync.ts`::disableStatusSyncFn | integration.manage |
| `lib/server/functions/status-sync.ts`::updateStatusMappingsFn | integration.manage |
| `lib/server/functions/statuses.ts`::fetchStatusesFn | status.view |
| `lib/server/functions/statuses.ts`::fetchStatusFn | status.view |
| `lib/server/functions/statuses.ts`::createStatusFn | status.manage |
| `lib/server/functions/statuses.ts`::updateStatusFn | status.manage |
| `lib/server/functions/statuses.ts`::deleteStatusFn | status.manage |
| `lib/server/functions/statuses.ts`::reorderStatusesFn | status.manage |
| `lib/server/functions/subscriptions.ts`::fetchSubscriptionStatus | END_USER (any authenticated) |
| `lib/server/functions/subscriptions.ts`::subscribeToPostFn | END_USER (any authenticated) |
| `lib/server/functions/subscriptions.ts`::unsubscribeFromPostFn | END_USER (any authenticated) |
| `lib/server/functions/subscriptions.ts`::updateSubscriptionLevelFn | END_USER (any authenticated) |
| `lib/server/functions/subscriptions.ts`::adminUpdateVoterSubscriptionFn | post.vote_on_behalf |
| `lib/server/functions/support-reporting.ts`::slaAttainmentFn | analytics.view |
| `lib/server/functions/support-reporting.ts`::workflowEffectivenessFn | analytics.view |
| `lib/server/functions/teams.ts`::listTeamsFn | member.view |
| `lib/server/functions/teams.ts`::listTeamsAdminFn | team.manage |
| `lib/server/functions/teams.ts`::listTeamMembersFn | team.manage |
| `lib/server/functions/teams.ts`::listAssignableTeammatesFn | team.manage |
| `lib/server/functions/teams.ts`::createTeamFn | team.manage |
| `lib/server/functions/teams.ts`::updateTeamFn | team.manage |
| `lib/server/functions/teams.ts`::deleteTeamFn | team.manage |
| `lib/server/functions/teams.ts`::setTeamMembersFn | team.manage |
| `lib/server/functions/teams.ts`::assignConversationTeamFn | conversation.assign |
| `lib/server/functions/tickets.ts`::listTicketsFn | ticket.view |
| `lib/server/functions/tickets.ts`::getTicketFn | ticket.view |
| `lib/server/functions/tickets.ts`::createTicketFn | ticket.create |
| `lib/server/functions/tickets.ts`::setTicketStatusFn | ticket.set_status |
| `lib/server/functions/tickets.ts`::assignTicketFn | ticket.assign |
| `lib/server/functions/tickets.ts`::setTicketPriorityFn | ticket.set_status |
| `lib/server/functions/tickets.ts`::getTicketLinksFn | ticket.view |
| `lib/server/functions/tickets.ts`::linkTicketToTrackerFn | ticket.assign |
| `lib/server/functions/tickets.ts`::unlinkTicketFromTrackerFn | ticket.assign |
| `lib/server/functions/tickets.ts`::listTicketStatusesFn | ticket.view |
| `lib/server/functions/tickets.ts`::createTicketStatusFn | ticket.manage_types |
| `lib/server/functions/tickets.ts`::updateTicketStatusFn | ticket.manage_types |
| `lib/server/functions/tickets.ts`::reorderTicketStatusesFn | ticket.manage_types |
| `lib/server/functions/tickets.ts`::deleteTicketStatusFn | ticket.manage_types |
| `lib/server/functions/tickets.ts`::getTicketStageLabelsFn | ticket.view |
| `lib/server/functions/tickets.ts`::setTicketStageLabelsFn | ticket.manage_types |
| `lib/server/functions/tickets.ts`::getTicketFormsFn | ticket.view |
| `lib/server/functions/tickets.ts`::setTicketFormFn | ticket.manage_types |
| `lib/server/functions/tickets.ts`::sendTicketMessageFn | ticket.reply |
| `lib/server/functions/tickets.ts`::addTicketNoteFn | ticket.note |
| `lib/server/functions/tickets.ts`::listTicketMessagesFn | ticket.view |
| `lib/server/functions/tickets.ts`::exportTicketTranscriptFn | ticket.view |
| `lib/server/functions/tickets.ts`::exportTicketTranscriptFn | TEAM-ONLY (~ticket.view) |
| `lib/server/functions/tickets.ts`::listMyTicketsFn | END_USER (any authenticated) |
| `lib/server/functions/tickets.ts`::getMyTicketFn | END_USER (any authenticated) |
| `lib/server/functions/tickets.ts`::getMyTicketThreadFn | END_USER (any authenticated) |
| `lib/server/functions/tickets.ts`::replyToMyTicketFn | END_USER (any authenticated) |
| `lib/server/functions/tickets.ts`::createMyTicketFn | END_USER (any authenticated) |
| `lib/server/functions/tickets.ts`::searchTicketsFn | ticket.view |
| `lib/server/functions/tickets.ts`::searchMyTicketsFn | END_USER (any authenticated) |
| `lib/server/functions/uploads.ts`::getPresignedUploadUrlFn | post.create |
| `lib/server/functions/uploads.ts`::getChangelogImageUploadUrlFn | changelog.manage |
| `lib/server/functions/uploads.ts`::getPostImageUploadUrlFn | post.create |
| `lib/server/functions/uploads.ts`::getLogoUploadUrlFn | settings.manage |
| `lib/server/functions/uploads.ts`::getFaviconUploadUrlFn | settings.manage |
| `lib/server/functions/uploads.ts`::getHeaderLogoUploadUrlFn | settings.manage |
| `lib/server/functions/uploads.ts`::getWidgetHeroUploadUrlFn | settings.manage |
| `lib/server/functions/uploads.ts`::getAvatarUploadUrlFn | END_USER (any authenticated) |
| `lib/server/functions/user.ts`::requirePrincipalId | END_USER (any authenticated) |
| `lib/server/functions/visitor-analytics.ts`::getVisitorAnalyticsData | analytics.view |
| `lib/server/functions/webhooks.ts`::fetchWebhooks | webhook.view |
| `lib/server/functions/webhooks.ts`::createWebhookFn | webhook.manage |
| `lib/server/functions/webhooks.ts`::updateWebhookFn | webhook.manage |
| `lib/server/functions/webhooks.ts`::deleteWebhookFn | webhook.manage |
| `lib/server/functions/webhooks.ts`::rotateWebhookSecretFn | webhook.manage |
| `lib/server/functions/workflows.ts`::listWorkflowsFn | routing.manage |
| `lib/server/functions/workflows.ts`::getWorkflowFn | routing.manage |
| `lib/server/functions/workflows.ts`::createWorkflowFn | workflow.manage |
| `lib/server/functions/workflows.ts`::updateWorkflowFn | workflow.manage |
| `lib/server/functions/workflows.ts`::setWorkflowStatusFn | workflow.manage |
| `lib/server/functions/workflows.ts`::deleteWorkflowFn | workflow.manage |
| `lib/server/integrations/asana/functions.ts`::getAsanaConnectUrl | integration.manage |
| `lib/server/integrations/asana/functions.ts`::fetchAsanaProjectsFn | integration.manage |
| `lib/server/integrations/azure-devops/functions.ts`::connectAzureDevOpsFn | integration.manage |
| `lib/server/integrations/azure-devops/functions.ts`::fetchAzureDevOpsProjectsFn | integration.manage |
| `lib/server/integrations/azure-devops/functions.ts`::fetchAzureDevOpsWorkItemTypesFn | integration.manage |
| `lib/server/integrations/clickup/functions.ts`::getClickUpConnectUrl | integration.manage |
| `lib/server/integrations/clickup/functions.ts`::fetchClickUpSpacesFn | integration.manage |
| `lib/server/integrations/clickup/functions.ts`::fetchClickUpListsFn | integration.manage |
| `lib/server/integrations/discord/functions.ts`::getDiscordConnectUrl | integration.manage |
| `lib/server/integrations/discord/functions.ts`::fetchDiscordChannelsFn | integration.manage |
| `lib/server/integrations/freshdesk/functions.ts`::saveFreshdeskKeyFn | integration.manage |
| `lib/server/integrations/github/functions.ts`::getGitHubConnectUrl | integration.manage |
| `lib/server/integrations/github/functions.ts`::fetchGitHubReposFn | integration.manage |
| `lib/server/integrations/gitlab/functions.ts`::getGitLabConnectUrl | integration.manage |
| `lib/server/integrations/gitlab/functions.ts`::fetchGitLabProjectsFn | integration.manage |
| `lib/server/integrations/hubspot/functions.ts`::getHubSpotConnectUrl | integration.manage |
| `lib/server/integrations/hubspot/functions.ts`::searchHubSpotContactFn | integration.view |
| `lib/server/integrations/intercom/functions.ts`::getIntercomConnectUrl | integration.manage |
| `lib/server/integrations/intercom/functions.ts`::searchIntercomContactFn | integration.view |
| `lib/server/integrations/jira/functions.ts`::getJiraConnectUrl | integration.manage |
| `lib/server/integrations/jira/functions.ts`::fetchJiraProjectsFn | integration.manage |
| `lib/server/integrations/jira/functions.ts`::fetchJiraIssueTypesFn | integration.manage |
| `lib/server/integrations/linear/functions.ts`::getLinearConnectUrl | integration.manage |
| `lib/server/integrations/linear/functions.ts`::fetchLinearTeamsFn | integration.manage |
| `lib/server/integrations/make/functions.ts`::saveMakeWebhookFn | integration.manage |
| `lib/server/integrations/monday/functions.ts`::getMondayConnectUrl | integration.manage |
| `lib/server/integrations/monday/functions.ts`::fetchMondayBoardsFn | integration.manage |
| `lib/server/integrations/n8n/functions.ts`::saveN8nWebhookFn | integration.manage |
| `lib/server/integrations/notion/functions.ts`::getNotionConnectUrl | integration.manage |
| `lib/server/integrations/notion/functions.ts`::fetchNotionDatabasesFn | integration.manage |
| `lib/server/integrations/ntfy/functions.ts`::saveNtfyFn | integration.manage |
| `lib/server/integrations/salesforce/functions.ts`::getSalesforceConnectUrl | integration.manage |
| `lib/server/integrations/shortcut/functions.ts`::saveShortcutTokenFn | integration.manage |
| `lib/server/integrations/shortcut/functions.ts`::fetchShortcutProjectsFn | integration.manage |
| `lib/server/integrations/slack/functions.ts`::getSlackConnectUrl | integration.manage |
| `lib/server/integrations/slack/functions.ts`::fetchSlackChannelsFn | integration.manage |
| `lib/server/integrations/stripe/functions.ts`::saveStripeKeyFn | integration.manage |
| `lib/server/integrations/teams/functions.ts`::getTeamsConnectUrl | integration.manage |
| `lib/server/integrations/teams/functions.ts`::fetchTeamsTeamsFn | integration.manage |
| `lib/server/integrations/teams/functions.ts`::fetchTeamsChannelsFn | integration.manage |
| `lib/server/integrations/trello/functions.ts`::getTrelloConnectUrl | integration.manage |
| `lib/server/integrations/trello/functions.ts`::fetchTrelloBoardsFn | integration.manage |
| `lib/server/integrations/trello/functions.ts`::fetchTrelloListsFn | integration.manage |
| `lib/server/integrations/zapier/functions.ts`::saveZapierWebhookFn | integration.manage |
| `lib/server/integrations/zendesk/functions.ts`::getZendeskConnectUrl | integration.manage |
| `lib/server/integrations/zendesk/functions.ts`::searchZendeskUserFn | integration.view |

### Public REST API (`withApiKeyAuth`) — 89 surfaces

| Surface | Enforces |
| --- | --- |
| `routes/api/admin/assistant/sandbox.ts`::handleSandbox | settings.manage |
| `routes/api/v1/apps/boards.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/apps/link.ts`::POST | integration.manage |
| `routes/api/v1/apps/linked.ts`::GET | integration.view |
| `routes/api/v1/apps/posts.ts`::POST | post.create |
| `routes/api/v1/apps/search.ts`::GET | post.view_private |
| `routes/api/v1/apps/suggest.ts`::GET | post.view_private |
| `routes/api/v1/apps/unlink.ts`::POST | integration.manage |
| `routes/api/v1/boards/$boardId.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/boards/$boardId.ts`::PATCH | board.manage |
| `routes/api/v1/boards/$boardId.ts`::DELETE | board.manage |
| `routes/api/v1/boards/index.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/boards/index.ts`::POST | board.manage |
| `routes/api/v1/changelog/$entryId.ts`::GET | changelog.view_draft |
| `routes/api/v1/changelog/$entryId.ts`::PATCH | changelog.manage |
| `routes/api/v1/changelog/$entryId.ts`::DELETE | changelog.manage |
| `routes/api/v1/changelog/index.ts`::GET | changelog.view_draft |
| `routes/api/v1/changelog/index.ts`::POST | changelog.manage |
| `routes/api/v1/comments/$commentId.ts`::GET | post.view_private |
| `routes/api/v1/comments/$commentId.ts`::PATCH | comment.edit |
| `routes/api/v1/comments/$commentId.ts`::DELETE | comment.edit |
| `routes/api/v1/conversations/$conversationId.messages.ts`::GET | conversation.view |
| `routes/api/v1/conversations/$conversationId.ts`::GET | conversation.view |
| `routes/api/v1/conversations/index.ts`::GET | conversation.view |
| `routes/api/v1/help-center/articles/$articleId.feedback.ts`::POST | PUBLIC (any valid key) |
| `routes/api/v1/help-center/articles/$articleId.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/help-center/articles/$articleId.ts`::PATCH | help_center.manage |
| `routes/api/v1/help-center/articles/$articleId.ts`::DELETE | help_center.manage |
| `routes/api/v1/help-center/articles/index.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/help-center/articles/index.ts`::POST | help_center.manage |
| `routes/api/v1/help-center/categories/$categoryId.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/help-center/categories/$categoryId.ts`::PATCH | help_center.manage |
| `routes/api/v1/help-center/categories/$categoryId.ts`::DELETE | help_center.manage |
| `routes/api/v1/help-center/categories/index.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/help-center/categories/index.ts`::POST | help_center.manage |
| `routes/api/v1/posts/$postId.activity.ts`::GET | post.view_private |
| `routes/api/v1/posts/$postId.comments.ts`::GET | post.view_private |
| `routes/api/v1/posts/$postId.comments.ts`::POST | comment.moderate |
| `routes/api/v1/posts/$postId.merge.ts`::POST | post.merge |
| `routes/api/v1/posts/$postId.ts`::GET | post.view_private |
| `routes/api/v1/posts/$postId.ts`::PATCH | DYNAMIC (post.edit | post.set_status | post.set_tags | post.set_owner) |
| `routes/api/v1/posts/$postId.ts`::DELETE | post.delete |
| `routes/api/v1/posts/$postId.vote.proxy.ts`::POST | post.vote_on_behalf |
| `routes/api/v1/posts/$postId.vote.proxy.ts`::DELETE | post.vote_on_behalf |
| `routes/api/v1/posts/$postId.vote.ts`::POST | post.vote_on_behalf |
| `routes/api/v1/posts/index.ts`::GET | post.view_private |
| `routes/api/v1/posts/index.ts`::POST | post.create |
| `routes/api/v1/principals/$principalId.ts`::GET | member.view |
| `routes/api/v1/principals/$principalId.ts`::PATCH | member.manage |
| `routes/api/v1/principals/$principalId.ts`::DELETE | member.manage |
| `routes/api/v1/principals/index.ts`::GET | member.view |
| `routes/api/v1/roadmaps/$roadmapId.posts.$postId.ts`::DELETE | roadmap.manage |
| `routes/api/v1/roadmaps/$roadmapId.posts.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/roadmaps/$roadmapId.posts.ts`::POST | roadmap.manage |
| `routes/api/v1/roadmaps/$roadmapId.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/roadmaps/$roadmapId.ts`::PATCH | roadmap.manage |
| `routes/api/v1/roadmaps/$roadmapId.ts`::DELETE | roadmap.manage |
| `routes/api/v1/roadmaps/index.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/roadmaps/index.ts`::POST | roadmap.manage |
| `routes/api/v1/segments/$slug.members.ts`::POST | segment.manage |
| `routes/api/v1/segments/$slug.members.ts`::DELETE | segment.manage |
| `routes/api/v1/statuses/$statusId.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/statuses/$statusId.ts`::PATCH | status.manage |
| `routes/api/v1/statuses/$statusId.ts`::DELETE | status.manage |
| `routes/api/v1/statuses/index.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/statuses/index.ts`::POST | status.manage |
| `routes/api/v1/suggestions/$suggestionId.accept.ts`::POST | suggestion.manage |
| `routes/api/v1/suggestions/$suggestionId.dismiss.ts`::POST | suggestion.manage |
| `routes/api/v1/suggestions/$suggestionId.restore.ts`::POST | suggestion.manage |
| `routes/api/v1/suggestions/index.ts`::GET | suggestion.view |
| `routes/api/v1/tags/$tagId.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/tags/$tagId.ts`::PATCH | tag.manage |
| `routes/api/v1/tags/$tagId.ts`::DELETE | tag.manage |
| `routes/api/v1/tags/index.ts`::GET | PUBLIC (any valid key) |
| `routes/api/v1/tags/index.ts`::POST | tag.manage |
| `routes/api/v1/tickets/$ticketId.messages.ts`::GET | ticket.view |
| `routes/api/v1/tickets/$ticketId.ts`::GET | ticket.view |
| `routes/api/v1/tickets/index.ts`::GET | ticket.view |
| `routes/api/v1/users/$principalId.ts`::GET | people.view |
| `routes/api/v1/users/$principalId.ts`::PATCH | people.manage |
| `routes/api/v1/users/$principalId.ts`::DELETE | people.manage |
| `routes/api/v1/users/identify.ts`::POST | people.manage |
| `routes/api/v1/users/index.ts`::GET | people.view |
| `routes/api/v1/webhooks/$webhookId.rotate.ts`::POST | webhook.manage |
| `routes/api/v1/webhooks/$webhookId.ts`::GET | webhook.view |
| `routes/api/v1/webhooks/$webhookId.ts`::PATCH | webhook.manage |
| `routes/api/v1/webhooks/$webhookId.ts`::DELETE | webhook.manage |
| `routes/api/v1/webhooks/index.ts`::GET | webhook.view |
| `routes/api/v1/webhooks/index.ts`::POST | webhook.manage |

### SSE stream (inline gate) — 1 surface

| Surface | Enforces |
| --- | --- |
| `routes/api/chat/stream.ts`::GET | TEAM-ONLY (~conversation.view) |

### MCP transport entry — 1 surface

| Surface | Enforces |
| --- | --- |
| `lib/server/mcp/handler.ts`::resolveAuthContext | MCP entry (tool scopes authorize) |

## 3. MCP tools

40 tools. "Team" = requires an admin/member role in addition to the scope.

| Tool | Scope(s) | Team |
| --- | --- | :---: |
| accept_suggestion | write:feedback | ✓ |
| add_comment | write:feedback | · |
| add_ticket_note | write:chat | ✓ |
| create_article | write:article | ✓ |
| create_changelog | write:changelog | ✓ |
| create_post | write:feedback | · |
| create_ticket | write:chat | ✓ |
| delete_article | write:article | ✓ |
| delete_changelog | write:changelog | ✓ |
| delete_comment | write:feedback | · |
| delete_post | write:feedback | ✓ |
| dismiss_suggestion | write:feedback | ✓ |
| get_conversation | read:chat | ✓ |
| get_details | read:article, read:feedback | ✓ |
| get_post_activity | read:feedback | ✓ |
| get_ticket | read:chat | ✓ |
| link_ticket | write:chat | ✓ |
| list_conversations | read:chat | ✓ |
| list_suggestions | read:feedback | ✓ |
| list_tickets | read:chat | ✓ |
| manage_category | write:article | ✓ |
| manage_roadmap_post | write:feedback | ✓ |
| merge_post | write:feedback | ✓ |
| proxy_vote | write:feedback | ✓ |
| react_to_comment | write:feedback | · |
| reply_to_conversation | write:chat | ✓ |
| reply_to_ticket | write:chat | ✓ |
| restore_post | write:feedback | ✓ |
| restore_suggestion | write:feedback | ✓ |
| search | read:article, read:feedback | ✓ |
| set_conversation_status | write:chat | ✓ |
| share_post | write:chat | ✓ |
| suggest_post | write:chat | ✓ |
| triage_post | write:feedback | ✓ |
| unlink_ticket | write:chat | ✓ |
| unmerge_post | write:feedback | ✓ |
| update_article | write:article | ✓ |
| update_changelog | write:changelog | ✓ |
| update_comment | write:feedback | · |
| vote_post | write:feedback | · |

### MCP scope holdings by class

Key scopes are enforced: an API key holds exactly its stored scopes (owner permissions ∩ key scopes on REST, per-tool scope guards on MCP). A key with NULL stored scopes (legacy, pre-scope-selection) holds every scope. OAuth grants carry their own enforced scopes.

| Class | read:article | read:chat | read:feedback | write:article | write:changelog | write:chat | write:feedback |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Scoped API key (admin-owned, read-only scopes) | ✓ | ✓ | ✓ | · | · | · | · |
| Full API key (admin-owned) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| OAuth client (member, read-only grant) | ✓ | ✓ | ✓ | · | · | · | · |

## 4. Entry points without a requireAuth/key gate

152 of 660 entry points hold no `requireAuth` / `withApiKeyAuth` / `requireTeamAuth` gate.
Each is expected to be intentionally public, a pre-auth flow, a signature-verified webhook, or a handler that delegates auth (e.g. the MCP route).
**Adding a row here is an access-control change** — confirm the new entry point is meant to be reachable without a gate.

| Entry point | Kind |
| --- | --- |
| `lib/server/functions/admin.ts`::checkOnboardingState | server-fn |
| `lib/server/functions/admin.ts`::fetchIntegrationCatalog | server-fn |
| `lib/server/functions/admin.ts`::getPublicAuthConfig | server-fn |
| `lib/server/functions/auth.ts`::lookupAuthMethodsFn | server-fn |
| `lib/server/functions/bootstrap.ts`::getBootstrapData | server-fn |
| `lib/server/functions/changelog.ts`::getPublicChangelogFn | server-fn |
| `lib/server/functions/changelog.ts`::listPublicChangelogsFn | server-fn |
| `lib/server/functions/comments.ts`::canPinCommentFn | server-fn |
| `lib/server/functions/comments.ts`::getCommentPermissionsFn | server-fn |
| `lib/server/functions/conversation.ts`::getConversationPresenceFn | server-fn |
| `lib/server/functions/conversation.ts`::getMessengerUnreadFn | server-fn |
| `lib/server/functions/conversation.ts`::getMyConversationFn | server-fn |
| `lib/server/functions/conversation.ts`::getMyConversationsFn | server-fn |
| `lib/server/functions/conversation.ts`::getWidgetTeamAvatarsFn | server-fn |
| `lib/server/functions/embeds.ts`::getEmbedPreviewFn | server-fn |
| `lib/server/functions/help-center.ts`::getPublicArticleBySlugFn | server-fn |
| `lib/server/functions/help-center.ts`::getPublicCategoryBySlugFn | server-fn |
| `lib/server/functions/help-center.ts`::listPopularPublicArticlesFn | server-fn |
| `lib/server/functions/help-center.ts`::listPublicArticlesFn | server-fn |
| `lib/server/functions/help-center.ts`::listPublicArticlesForCategoryFn | server-fn |
| `lib/server/functions/help-center.ts`::listPublicCategoriesFn | server-fn |
| `lib/server/functions/help-center.ts`::listPublicCategoryEditorsFn | server-fn |
| `lib/server/functions/help-center.ts`::recordArticleFeedbackFn | server-fn |
| `lib/server/functions/help-center.ts`::searchPublicArticlesFn | server-fn |
| `lib/server/functions/instant-sso.ts`::resolveInstantSsoRedirectFn | server-fn |
| `lib/server/functions/invitations.ts`::acceptInvitationFn | server-fn |
| `lib/server/functions/invitations.ts`::getInvitationDetailsFn | server-fn |
| `lib/server/functions/invitations.ts`::getInviteBrandingFn | server-fn |
| `lib/server/functions/invitations.ts`::setPasswordFn | server-fn |
| `lib/server/functions/locale.ts`::getPortalLocaleFn | server-fn |
| `lib/server/functions/onboarding.ts`::listBoardsForOnboarding | server-fn |
| `lib/server/functions/onboarding.ts`::saveUseCaseFn | server-fn |
| `lib/server/functions/onboarding.ts`::saveUserNameFn | server-fn |
| `lib/server/functions/onboarding.ts`::setupWorkspaceFn | server-fn |
| `lib/server/functions/portal-access.ts`::evaluateMyPortalAccessFn | server-fn |
| `lib/server/functions/portal-access.ts`::recordPortalAccessDeniedFn | server-fn |
| `lib/server/functions/portal-invites.ts`::acceptPortalInviteFn | server-fn |
| `lib/server/functions/portal.ts`::fetchAvatars | server-fn |
| `lib/server/functions/portal.ts`::fetchBoardCapabilitiesFn | server-fn |
| `lib/server/functions/portal.ts`::fetchPortalData | server-fn |
| `lib/server/functions/portal.ts`::fetchPublicBoardBySlug | server-fn |
| `lib/server/functions/portal.ts`::fetchPublicBoards | server-fn |
| `lib/server/functions/portal.ts`::fetchPublicPostDetail | server-fn |
| `lib/server/functions/portal.ts`::fetchPublicPosts | server-fn |
| `lib/server/functions/portal.ts`::fetchPublicRoadmapPosts | server-fn |
| `lib/server/functions/portal.ts`::fetchPublicRoadmaps | server-fn |
| `lib/server/functions/portal.ts`::fetchPublicStatuses | server-fn |
| `lib/server/functions/portal.ts`::fetchPublicTags | server-fn |
| `lib/server/functions/portal.ts`::fetchUserAvatar | server-fn |
| `lib/server/functions/portal.ts`::getCommentsSectionDataFn | server-fn |
| `lib/server/functions/portal.ts`::getPrincipalIdForUser | server-fn |
| `lib/server/functions/post-merge.ts`::getPostMergeInfoFn | server-fn |
| `lib/server/functions/public-posts.ts`::findSimilarPostsFn | server-fn |
| `lib/server/functions/public-posts.ts`::getPostPermissionsFn | server-fn |
| `lib/server/functions/public-posts.ts`::getPublicRoadmapPostsFn | server-fn |
| `lib/server/functions/public-posts.ts`::getRoadmapPostsByStatusFn | server-fn |
| `lib/server/functions/public-posts.ts`::getVotedPostsFn | server-fn |
| `lib/server/functions/public-posts.ts`::getVoteSidebarDataFn | server-fn |
| `lib/server/functions/public-posts.ts`::listPublicPostsFn | server-fn |
| `lib/server/functions/public-posts.ts`::listPublicRoadmapsFn | server-fn |
| `lib/server/functions/recovery-codes-consume.ts`::consumeRecoveryCodeFn | server-fn |
| `lib/server/functions/settings-utils.ts`::fetchSettingsBrandingData | server-fn |
| `lib/server/functions/settings-utils.ts`::fetchSettingsFaviconData | server-fn |
| `lib/server/functions/settings-utils.ts`::fetchSettingsHeaderLogoData | server-fn |
| `lib/server/functions/settings-utils.ts`::fetchSettingsLogoData | server-fn |
| `lib/server/functions/settings.ts`::fetchBrandingConfig | server-fn |
| `lib/server/functions/settings.ts`::fetchCustomCssFn | server-fn |
| `lib/server/functions/settings.ts`::fetchPublicAuthConfig | server-fn |
| `lib/server/functions/settings.ts`::fetchPublicPortalConfig | server-fn |
| `lib/server/functions/settings.ts`::fetchUserProfile | server-fn |
| `lib/server/functions/subscriptions.ts`::processUnsubscribeTokenFn | server-fn |
| `lib/server/functions/uploads.ts`::checkS3ConfiguredFn | server-fn |
| `lib/server/functions/uploads.ts`::getWidgetImageUploadUrlFn | server-fn |
| `lib/server/functions/user.ts`::getNotificationPreferencesFn | server-fn |
| `lib/server/functions/user.ts`::getProfileFn | server-fn |
| `lib/server/functions/user.ts`::getUserRoleFn | server-fn |
| `lib/server/functions/user.ts`::getUserStatsFn | server-fn |
| `lib/server/functions/user.ts`::removeAvatarFn | server-fn |
| `lib/server/functions/user.ts`::saveAvatarKeyFn | server-fn |
| `lib/server/functions/user.ts`::updateNotificationPreferencesFn | server-fn |
| `lib/server/functions/user.ts`::updateProfileNameFn | server-fn |
| `lib/server/functions/version.ts`::getLatestVersion | server-fn |
| `lib/server/functions/widget-capabilities.ts`::getWidgetCapabilitiesFn | server-fn |
| `lib/server/functions/workspace-utils.ts`::requireWorkspaceRole | server-fn |
| `lib/server/functions/workspace.ts`::getCurrentUserRole | server-fn |
| `lib/server/functions/workspace.ts`::getSettings | server-fn |
| `lib/server/functions/workspace.ts`::validateApiWorkspaceAccess | server-fn |
| `routes/[.]well-known.oauth-authorization-server.ts`::GET | route |
| `routes/[.]well-known.oauth-protected-resource.ts`::GET | route |
| `routes/[.]well-known.openid-configuration.ts`::GET | route |
| `routes/api/auth/$.ts`::GET | route |
| `routes/api/auth/$.ts`::POST | route |
| `routes/api/auth/invitation.$invitationId.ts`::GET | route |
| `routes/api/auth/portal-signin.ts`::POST | route |
| `routes/api/chat/email/inbound.ts`::POST | route |
| `routes/api/chat/stream.ts`::GET | route |
| `routes/api/devices.ts`::DELETE | route |
| `routes/api/devices.ts`::POST | route |
| `routes/api/export.ts`::GET | route |
| `routes/api/health.live.ts`::GET | route |
| `routes/api/health.ready.ts`::GET | route |
| `routes/api/health.ts`::GET | route |
| `routes/api/import/index.ts`::POST | route |
| `routes/api/integrations/$type/identify.ts`::POST | route |
| `routes/api/integrations/$type/webhook.ts`::POST | route |
| `routes/api/integrations/slack/events.ts`::POST | route |
| `routes/api/integrations/slack/interact.ts`::POST | route |
| `routes/api/mcp.ts`::DELETE | route |
| `routes/api/mcp.ts`::GET | route |
| `routes/api/mcp.ts`::POST | route |
| `routes/api/portal/upload.ts`::POST | route |
| `routes/api/storage/$.ts`::GET | route |
| `routes/api/storage/$.ts`::PUT | route |
| `routes/api/track.ts`::OPTIONS | route |
| `routes/api/track.ts`::POST | route |
| `routes/api/upload/image.ts`::POST | route |
| `routes/api/user/avatar.$userId.ts`::GET | route |
| `routes/api/user/profile.ts`::DELETE | route |
| `routes/api/user/profile.ts`::GET | route |
| `routes/api/user/profile.ts`::PATCH | route |
| `routes/api/v1/admin/usage.ts`::GET | route |
| `routes/api/v1/apps/boards.ts`::OPTIONS | route |
| `routes/api/v1/apps/link.ts`::OPTIONS | route |
| `routes/api/v1/apps/linked.ts`::OPTIONS | route |
| `routes/api/v1/apps/posts.ts`::OPTIONS | route |
| `routes/api/v1/apps/search.ts`::OPTIONS | route |
| `routes/api/v1/apps/suggest.ts`::OPTIONS | route |
| `routes/api/v1/apps/unlink.ts`::OPTIONS | route |
| `routes/api/v1/docs.ts`::GET | route |
| `routes/api/v1/mentions/suggest.ts`::GET | route |
| `routes/api/v1/openapi.json.ts`::GET | route |
| `routes/api/v1/users/$principalId.card.ts`::GET | route |
| `routes/api/widget/config[.]json.ts`::GET | route |
| `routes/api/widget/device.ts`::POST | route |
| `routes/api/widget/identify.ts`::POST | route |
| `routes/api/widget/kb-ask.ts`::GET | route |
| `routes/api/widget/kb-search.ts`::GET | route |
| `routes/api/widget/sdk[.]js.ts`::GET | route |
| `routes/api/widget/search.ts`::GET | route |
| `routes/api/widget/session.ts`::GET | route |
| `routes/api/widget/upload.ts`::POST | route |
| `routes/apps.tsx`::setIframeHeaders | server-fn |
| `routes/auth.widget-handoff.tsx`::consumeWidgetHandoffFn | server-fn |
| `routes/changelog/feed.ts`::GET | route |
| `routes/hc/sitemap[.]xml.ts`::GET | route |
| `routes/oauth/$integration/callback.ts`::GET | route |
| `routes/oauth/$integration/connect.ts`::GET | route |
| `routes/robots[.]txt.ts`::GET | route |
| `routes/sitemap[.]xml.ts`::GET | route |
| `routes/widget.tsx`::getPortalSessionToken | server-fn |
| `routes/widget.tsx`::getWidgetLocale | server-fn |
| `routes/widget.tsx`::setIframeHeaders | server-fn |
