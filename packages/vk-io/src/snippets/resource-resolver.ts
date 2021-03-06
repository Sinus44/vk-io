import { URL } from 'url';

import { VK } from '../vk';
import { ResourceError } from '../errors';
import { ResourceType, ResourceErrorCode } from '../utils/constants';
import { parseResourceRe, parseAttachmentRe, parseOwnerResourceRe } from '../utils/helpers';

const {
	INVALID_URL,
	INVALID_RESOURCE,
	RESOURCE_NOT_FOUND
} = ResourceErrorCode;

const numberRe = /^-?\d+$/;

const hasProtocolRe = /https?:\/\//i;
const isVKUrl = /^(?:https?:\/\/)?(?:m\.)?vk\.com/i;

const isUserMentionRe = /\*|@/;
const systemMentionRe = /\[([^|]+)|([^|\]]+)\]/;

/**
 * Switch resource types
 */
const enumResourceTypes: Record<string, ResourceType> = {
	id: ResourceType.USER,
	club: ResourceType.GROUP,
	public: ResourceType.GROUP,
	app: ResourceType.APPLICATION
};

/**
 * Remove search param
 */
const removeSearchParam = /(\?|&)[^=]+=/;

/**
 * Resolve the attachment resource
 */
const resolveOwnerResource = (resource: string, pattern: RegExp): {
	id: number;
	ownerId: number;
	type: string;
} => {
	const {
		1: type,
		2: ownerId,
		3: id
	} = resource.match(pattern)!;

	return {
		id: Number(id),
		ownerId: Number(ownerId),
		type: type.toLowerCase().replace(removeSearchParam, '')
	};
};

export interface IResolvedResource {
	id: number;
	ownerId?: number;
	type: 'user' | 'group' | 'application' | 'albums' | 'album' | 'wall' | 'club' | 'photo' | 'video' | 'audio' | string;
}

export class ResourceResolver {
	protected vk: VK;

	/**
	 * Constructor
	 */
	public constructor(vk: VK) {
		this.vk = vk;
	}

	/**
	 * Resolve resource
	 */
	public async resolve(rawResource: string | number): Promise<IResolvedResource> {
		if (!rawResource) {
			throw new ResourceError({
				code: INVALID_RESOURCE,
				message: 'Resource is required'
			});
		}

		const resource = String(rawResource).trim();

		if (numberRe.test(resource)) {
			return this.resolveNumber(Number(resource));
		}

		const isMention = (
			isUserMentionRe.test(resource) || systemMentionRe.test(resource)
		);

		if (isMention) {
			return this.resolveMention(resource);
		}

		if (isVKUrl.test(resource)) {
			return this.resolveUrl(resource);
		}

		return this.resolveScreenName(resource);
	}

	/**
	 * Resolve number
	 */
	protected resolveNumber(resource: number): Promise<IResolvedResource> {
		const isGroup = resource < 0;

		const type = isGroup
			? 'club'
			: 'id';

		return this.resolveScreenName(type + (
			isGroup
				? -resource
				: resource
		));
	}

	/**
	 * Resolve resource mention
	 */
	protected resolveMention(resource: string): Promise<IResolvedResource> {
		if (isUserMentionRe.test(resource)) {
			return this.resolveScreenName(resource.substring(1));
		}

		const { 1: mentionResource } = resource.match(systemMentionRe)!;

		return this.resolveScreenName(mentionResource);
	}

	/**
	 * Resolve resource url
	 */
	protected async resolveUrl(rawResourceUrl: string): Promise<IResolvedResource> {
		const resourceUrl = !hasProtocolRe.test(rawResourceUrl)
			? `https://${rawResourceUrl}`
			: rawResourceUrl;

		const { pathname, search } = new URL(resourceUrl);

		if (pathname === '/') {
			throw new ResourceError({
				code: INVALID_URL,
				message: 'URL should contain path'
			});
		}

		if (parseAttachmentRe.test(search)) {
			return resolveOwnerResource(search, parseAttachmentRe);
		}

		if (parseOwnerResourceRe.test(search)) {
			return resolveOwnerResource(search, parseOwnerResourceRe);
		}

		return this.resolveScreenName(pathname.substring(1));
	}

	/**
	 * Resolve screen name
	 */
	protected async resolveScreenName(resource: string): Promise<IResolvedResource> {
		if (parseAttachmentRe.test(resource)) {
			return resolveOwnerResource(resource, parseAttachmentRe);
		}

		if (parseOwnerResourceRe.test(resource)) {
			return resolveOwnerResource(resource, parseOwnerResourceRe);
		}

		if (parseResourceRe.test(resource)) {
			const { 1: typeResource, 2: id } = resource.match(parseResourceRe)!;

			let type = typeResource.toLowerCase();

			if (enumResourceTypes[type] !== undefined) {
				type = enumResourceTypes[type];
			}

			return {
				id: Number(id),
				type
			};
		}

		const response = await this.vk.api.utils.resolveScreenName({
			screen_name: resource
		});

		if (Array.isArray(response)) {
			throw new ResourceError({
				message: 'Resource not found',
				code: RESOURCE_NOT_FOUND
			});
		}

		// @ts-ignore
		const { type, object_id: id }: Required<typeof response> = response;

		if (type === 'page') {
			return {
				id,
				type: ResourceType.GROUP
			};
		}

		return { id, type };
	}
}
