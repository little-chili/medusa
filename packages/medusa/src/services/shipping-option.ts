import { MedusaError } from "medusa-core-utils"
import { BaseService } from "medusa-interfaces"
import { DeepPartial, EntityManager } from "typeorm"
import { TransactionBaseService } from "../interfaces"
import {
  Cart,
  Order,
  ShippingMethod,
  ShippingOption,
  ShippingOptionPriceType,
  ShippingOptionRequirement,
} from "../models"
import { ShippingMethodRepository } from "../repositories/shipping-method"
import { ShippingOptionRepository } from "../repositories/shipping-option"
import { ShippingOptionRequirementRepository } from "../repositories/shipping-option-requirement"
import { ExtendedFindConfig, FindConfig, Selector } from "../types/common"
import {
  CreateShippingMethodDto,
  ShippingMethodUpdate,
  UpdateShippingOptionProps,
  CreateShippingOptionProps,
} from "../types/shipping-options"
import { buildQuery, validateId } from "../utils"
import FulfillmentProviderService from "./fulfillment-provider"
import RegionService from "./region"

/**
 * Provides layer to manipulate profiles.
 * @extends BaseService
 */
class ShippingOptionService extends TransactionBaseService<ShippingOptionService> {
  protected readonly providerService_: FulfillmentProviderService
  protected readonly regionService_: RegionService
  protected readonly requirementRepository_: typeof ShippingOptionRequirementRepository
  protected readonly optionRepository_: typeof ShippingOptionRepository
  protected readonly methodRepository_: typeof ShippingMethodRepository

  protected readonly manager_: EntityManager
  protected readonly transactionManager_: EntityManager | undefined

  constructor({
    manager,
    shippingOptionRepository,
    shippingOptionRequirementRepository,
    shippingMethodRepository,
    fulfillmentProviderService,
    regionService,
  }) {
    // eslint-disable-next-line prefer-rest-params
    super(arguments[0])

    this.manager_ = manager
    this.optionRepository_ = shippingOptionRepository
    this.methodRepository_ = shippingMethodRepository
    this.requirementRepository_ = shippingOptionRequirementRepository
    this.providerService_ = fulfillmentProviderService
    this.regionService_ = regionService
  }

  /**
   * Validates a requirement
   * @param {ShippingOptionRequirement} requirement - the requirement to validate
   * @param {string} optionId - the id to validate the requirement
   * @return {ShippingOptionRequirement} a validated shipping requirement
   */
  async validateRequirement_(
    requirement: ShippingOptionRequirement,
    optionId: string | undefined = undefined
  ): Promise<ShippingOptionRequirement> {
    if (!requirement.type) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A Shipping Requirement must have a type field"
      )
    }

    if (
      requirement.type !== "min_subtotal" &&
      requirement.type !== "max_subtotal"
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Requirement type must be one of min_subtotal, max_subtotal"
      )
    }

    const reqRepo = this.manager_.getCustomRepository(
      this.requirementRepository_
    )

    const existingReq = await reqRepo.findOne({
      where: { id: requirement.id },
    })

    if (!existingReq && requirement.id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "ID does not exist")
    }

    // If no option id is provided, we are currently in the process of creating
    // a new shipping option. Therefore, simply return the requirement, such
    // that the cascading will take care of the creation of the requirement.
    if (!optionId) {
      return requirement
    }

    let req
    if (existingReq) {
      req = await reqRepo.save({
        ...existingReq,
        ...requirement,
      })
    } else {
      const created = reqRepo.create({
        ...requirement,
        shipping_option_id: optionId,
      })

      req = await reqRepo.save(created)
    }

    return req
  }

  /**
   * @param {Object} selector - the query object for find
   * @param {object} config - config object
   * @return {Promise} the result of the find operation
   */
  async list(
    selector: Selector<ShippingMethod>,
    config: FindConfig<ShippingOption> = { skip: 0, take: 50 }
  ): Promise<ShippingOption[]> {
    return await this.atomicPhase_(async (transactionManager) => {
      const optRepo = transactionManager.getCustomRepository(
        this.optionRepository_
      )

      const query = buildQuery(selector, config)
      return optRepo.find(query)
    })
  }

  /**
   * @param {Object} selector - the query object for find
   * @param {object} config - config object
   * @return {Promise} the result of the find operation
   */
  async listAndCount(
    selector: Selector<ShippingMethod>,
    config: FindConfig<ShippingOption> = { skip: 0, take: 50 }
  ): Promise<[ShippingOption[], number]> {
    return await this.atomicPhase_(async (transactionManager) => {
      const optRepo = transactionManager.getCustomRepository(
        this.optionRepository_
      )

      const query = buildQuery(selector, config)
      return await optRepo.findAndCount(query)
    })
  }

  /**
   * Gets a profile by id.
   * Throws in case of DB Error and if profile was not found.
   * @param {string} optionId - the id of the profile to get.
   * @param {object} options - the options to get a profile
   * @return {Promise<Product>} the profile document.
   */
  async retrieve(
    optionId,
    options: { select?: (keyof ShippingOption)[]; relations?: string[] } = {}
  ): Promise<ShippingOption> {
    return await this.atomicPhase_(async (transactionManager) => {
      const soRepo: ShippingOptionRepository =
        transactionManager.getCustomRepository(this.optionRepository_)
      const validatedId = validateId(optionId)

      const query: ExtendedFindConfig<ShippingOption> = {
        where: { id: validatedId },
      }

      if (options.select) {
        query.select = options.select
      }

      if (options.relations) {
        query.relations = options.relations
      }

      const option = await soRepo.findOne(query)

      if (!option) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Shipping Option with ${optionId} was not found`
        )
      }

      return option
    })
  }

  /**
   * Updates a shipping method's associations. Useful when a cart is completed
   * and its methods should be copied to an order/swap entity.
   * @param {string} id - the id of the shipping method to update
   * @param {object} update - the values to update the method with
   * @return {Promise<ShippingMethod>} the resulting shipping method
   */
  async updateShippingMethod(
    id: string,
    update: ShippingMethodUpdate
  ): Promise<ShippingMethod | undefined> {
    return await this.atomicPhase_(async (manager) => {
      const methodRepo: ShippingMethodRepository = manager.getCustomRepository(
        this.methodRepository_
      )
      const method = await methodRepo.findOne({ where: { id } })

      if (!method) {
        return undefined
      }

      for (const key of Object.keys(update).filter(
        (k) => typeof update[k] !== `undefined`
      )) {
        method[key] = update[key]
      }

      return methodRepo.save(method)
    })
  }

  /**
   * Removes a given shipping method
   * @param {ShippingMethod | Array<ShippingMethod>} shippingMethods - the shipping method to remove
   * @returns removed shipping methods
   */
  async deleteShippingMethods(
    shippingMethods: ShippingMethod | ShippingMethod[]
  ): Promise<ShippingMethod[]> {
    const removeEntities: ShippingMethod[] = Array.isArray(shippingMethods)
      ? shippingMethods
      : [shippingMethods]

    return await this.atomicPhase_(async (manager) => {
      const methodRepo = manager.getCustomRepository(this.methodRepository_)
      return await methodRepo.remove(removeEntities)
    })
  }

  /**
   * Creates a shipping method for a given cart.
   * @param {string} optionId - the id of the option to use for the method.
   * @param {object} data - the optional provider data to use.
   * @param {object} config - the cart to create the shipping method for.
   * @return {ShippingMethod} the resulting shipping method.
   */
  async createShippingMethod(
    optionId: string,
    data: object,
    config: CreateShippingMethodDto
  ): Promise<ShippingMethod> {
    return await this.atomicPhase_(async (manager) => {
      const option = await this.retrieve(optionId, {
        relations: ["requirements"],
      })

      const methodRepo = manager.getCustomRepository(this.methodRepository_)

      if (typeof config.cart !== "undefined") {
        this.validateCartOption(option, config.cart)
      }

      const validatedData = await this.providerService_.validateFulfillmentData(
        option,
        data,
        config.cart || {}
      )

      let methodPrice
      if (typeof config.price === "number") {
        methodPrice = config.price
      } else {
        methodPrice = await this.getPrice_(option, validatedData, config.cart)
      }

      const toCreate: Partial<ShippingMethod> = {
        shipping_option_id: option.id,
        data: validatedData,
        price: methodPrice,
      }

      if (config.order) {
        toCreate.order_id = config.order.id
      }

      if (config.cart) {
        toCreate.cart_id = config.cart.id
      }

      if (config.cart_id) {
        toCreate.cart_id = config.cart_id
      }

      if (config.return_id) {
        toCreate.return_id = config.return_id
      }

      if (config.order_id) {
        toCreate.order_id = config.order_id
      }

      if (config.claim_order_id) {
        toCreate.claim_order_id = config.claim_order_id
      }

      const method = await methodRepo.create(toCreate)

      const created = await methodRepo.save(method)

      return created
    })
  }

  /**
   * Checks if a given option id is a valid option for a cart. If it is the
   * option is returned with the correct price. Throws when region_ids do not
   * match, or when the shipping option requirements are not satisfied.
   * @param {object} option - the option object to check
   * @param {Cart} cart - the cart object to check against
   * @return {ShippingOption} the validated shipping option
   */
  validateCartOption(
    option: ShippingOption,
    cart: Cart
  ): ShippingOption | null {
    if (option.is_return) {
      return null
    }

    if (cart.region_id !== option.region_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The shipping option is not available in the cart's region"
      )
    }

    const subtotal = cart.subtotal as number

    const requirementResults: boolean[] = option.requirements.map(
      (requirement) => {
        switch (requirement.type) {
          case "max_subtotal":
            return requirement.amount > subtotal
          case "min_subtotal":
            return requirement.amount <= subtotal
          default:
            return true
        }
      }
    )

    if (!requirementResults.every(Boolean)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "The Cart does not satisfy the shipping option's requirements"
      )
    }

    return option
  }

  /**
   * Creates a new shipping option. Used both for outbound and inbound shipping
   * options. The difference is registered by the `is_return` field which
   * defaults to false.
   * @param {ShippingOption} data - the data to create shipping options
   * @return {Promise<ShippingOption>} the result of the create operation
   */
  async create(data: CreateShippingOptionProps): Promise<ShippingOption> {
    return this.atomicPhase_(async (manager) => {
      const optionRepo = manager.getCustomRepository(this.optionRepository_)
      const option = await optionRepo.create(
        data as DeepPartial<ShippingOption>
      )

      const region = await this.regionService_
        .withTransaction(manager)
        .retrieve(option.region_id, {
          relations: ["fulfillment_providers"],
        })

      if (
        !region.fulfillment_providers.find(
          ({ id }) => id === option.provider_id
        )
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "The fulfillment provider is not available in the provided region"
        )
      }

      option.price_type = await this.validatePriceType_(data.price_type, option)
      option.amount =
        data.price_type === "calculated" ? null : data.amount ?? null

      const isValid = await this.providerService_.validateOption(option)

      if (!isValid) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "The fulfillment provider cannot validate the shipping option"
        )
      }

      if (typeof data.requirements !== "undefined") {
        const acc: ShippingOptionRequirement[] = []
        for (const r of data.requirements) {
          const validated = await this.validateRequirement_(r)

          if (acc.find((raw) => raw.type === validated.type)) {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              "Only one requirement of each type is allowed"
            )
          }

          if (
            acc.find(
              (raw) =>
                (raw.type === "max_subtotal" &&
                  validated.amount > raw.amount) ||
                (raw.type === "min_subtotal" && validated.amount < raw.amount)
            )
          ) {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              "Max. subtotal must be greater than Min. subtotal"
            )
          }

          acc.push(validated)
        }
      }

      const result = await optionRepo.save(option)
      return result
    })
  }

  /**
   * @typedef ShippingOptionPrice
   * @property {string} type - one of flat_rate, calculated
   * @property {number} value - the value if available
   */

  /**
   * Validates a shipping option price
   * @param {ShippingOptionPriceType} priceType - the price to validate
   * @param {ShippingOption} option - the option to validate against
   * @return {Promise<ShippingOptionPriceType>} the validated price
   */
  async validatePriceType_(
    priceType: ShippingOptionPriceType,
    option: ShippingOption
  ): Promise<ShippingOptionPriceType> {
    if (
      !priceType ||
      (priceType !== "flat_rate" && priceType !== "calculated")
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The price must be of type flat_rate or calculated"
      )
    }

    if (priceType === "calculated") {
      const canCalculate = await this.providerService_.canCalculate(option)
      if (!canCalculate) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "The fulfillment provider cannot calculate prices for this option"
        )
      }
    }

    return priceType
  }

  /**
   * Updates a profile. Metadata updates and product updates should use
   * dedicated methods, e.g. `setMetadata`, etc. The function
   * will throw errors if metadata or product updates are attempted.
   * @param {string} optionId - the id of the option. Must be a string that
   *   can be casted to an ObjectId
   * @param {object} update - an object with the update values.
   * @return {Promise} resolves to the update result.
   */
  async update(
    optionId: string,
    update: UpdateShippingOptionProps
  ): Promise<ShippingOption> {
    return this.atomicPhase_(async (manager) => {
      const option = await this.retrieve(optionId, {
        relations: ["requirements"],
      })

      if (typeof update.metadata !== "undefined") {
        option.metadata = await this.setMetadata_(option, update.metadata)
      }

      if (update.region_id || update.provider_id || update.data) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "Region and Provider cannot be updated after creation"
        )
      }

      if (typeof update.is_return !== "undefined") {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "is_return cannot be changed after creation"
        )
      }

      if (typeof update.requirements !== "undefined") {
        const acc: ShippingOptionRequirement[] = []
        for (const r of update.requirements) {
          const validated = await this.validateRequirement_(r, optionId)

          if (acc.find((raw) => raw.type === validated.type)) {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              "Only one requirement of each type is allowed"
            )
          }

          if (
            acc.find(
              (raw) =>
                (raw.type === "max_subtotal" &&
                  validated.amount > raw.amount) ||
                (raw.type === "min_subtotal" && validated.amount < raw.amount)
            )
          ) {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              "Max. subtotal must be greater than Min. subtotal"
            )
          }

          acc.push(validated)
        }

        if (option.requirements) {
          const accReqs = acc.map((a) => a.id)
          const toRemove = option.requirements.filter(
            (r) => !accReqs.includes(r.id)
          )
          await Promise.all(
            toRemove.map(async (req) => {
              await this.removeRequirement(req.id)
            })
          )
        }

        option.requirements = acc
      }

      if (typeof update.price_type !== "undefined") {
        option.price_type = await this.validatePriceType_(
          update.price_type,
          option
        )
        if (update.price_type === "calculated") {
          option.amount = null
        }
      }

      if (
        typeof update.amount !== "undefined" &&
        option.price_type !== "calculated"
      ) {
        option.amount = update.amount
      }

      if (typeof update.name !== "undefined") {
        option.name = update.name
      }

      if (typeof update.admin_only !== "undefined") {
        option.admin_only = update.admin_only
      }

      const optionRepo = manager.getCustomRepository(this.optionRepository_)
      return await optionRepo.save(option)
    })
  }

  /**
   * Deletes a profile with a given profile id.
   * @param {string} optionId - the id of the profile to delete. Must be
   *   castable as an ObjectId
   * @return {Promise} the result of the delete operation.
   */
  async delete(optionId: string): Promise<ShippingOption | void> {
    try {
      const option = await this.retrieve(optionId)

      const optionRepo = this.manager_.getCustomRepository(
        this.optionRepository_
      )

      return optionRepo.softRemove(option)
    } catch (error) {
      // Delete is idempotent, but we return a promise to allow then-chaining
      return Promise.resolve()
    }
  }

  /**
   * Adds a requirement to a shipping option. Only 1 requirement of each type
   * is allowed.
   * @param {string} optionId - the option to add the requirement to.
   * @param {ShippingOptionRequirement} requirement - the requirement for the option.
   * @return {Promise} the result of update
   */
  async addRequirement(
    optionId: string,
    requirement: ShippingOptionRequirement
  ): Promise<ShippingOption> {
    return this.atomicPhase_(async (manager) => {
      const option = await this.retrieve(optionId, {
        relations: ["requirements"],
      })
      const validatedReq = await this.validateRequirement_(requirement)

      if (option.requirements.find((r) => r.type === validatedReq.type)) {
        throw new MedusaError(
          MedusaError.Types.DUPLICATE_ERROR,
          `A requirement with type: ${validatedReq.type} already exists`
        )
      }

      option.requirements.push(validatedReq)

      const optionRepo = manager.getCustomRepository(this.optionRepository_)
      return optionRepo.save(option)
    })
  }

  /**
   * Removes a requirement from a shipping option
   * @param {string} requirementId - the id of the requirement to remove
   * @return {Promise} the result of update
   */
  async removeRequirement(
    requirementId
  ): Promise<ShippingOptionRequirement | void> {
    return await this.atomicPhase_(async (manager) => {
      const reqRepo: ShippingOptionRequirementRepository =
        manager.getCustomRepository(this.requirementRepository_)

      const requirement = await reqRepo.findOne({
        where: { id: requirementId },
      })
      // Delete is idempotent, but we return a promise to allow then-chaining
      if (typeof requirement === "undefined") {
        return Promise.resolve()
      }

      return await reqRepo.softRemove(requirement)
    })
  }

  /**
   * Decorates a shipping option.
   * @param {ShippingOption} optionId - the shipping option to decorate using optionId.
   * @param {string[]} fields - the fields to include.
   * @param {string[]} expandFields - fields to expand.
   * @return {ShippingOption} the decorated ShippingOption.
   */
  async decorate(
    optionId: string,
    fields: (keyof ShippingOption)[] = [],
    expandFields: (keyof ShippingOption)[] = []
  ): Promise<ShippingOption> {
    const requiredFields: (keyof ShippingOption)[] = ["id", "metadata"]

    fields = fields.concat(requiredFields)

    return await this.retrieve(optionId, {
      select: fields,
      relations: expandFields,
    })
  }

  /**
   * Dedicated method to set metadata for a shipping option.
   * @param {object} option - the option to set metadata for.
   * @param {object} metadata - object for metadata field
   * @return {Promise} resolves to the updated result.
   */
  async setMetadata_(
    option: ShippingOption,
    metadata: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const existing = option.metadata || {}
    const newData = {}
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof key !== "string") {
        throw new MedusaError(
          MedusaError.Types.INVALID_ARGUMENT,
          "Key type is invalid. Metadata keys must be strings"
        )
      }

      newData[key] = value
    }

    const updated = {
      ...existing,
      ...newData,
    }

    return updated
  }

  /**
   * Returns the amount to be paid for a shipping method. Will ask the
   * fulfillment provider to calculate the price if the shipping option has the
   * price type "calculated".
   * @param {ShippingOption} option - the shipping option to retrieve the price
   *   for.
   * @param {ShippingData} data - the shipping data to retrieve the price.
   * @param {Cart | Order} cart - the context in which the price should be
   *   retrieved.
   * @return {Promise<Number>} the price of the shipping option.
   */
  async getPrice_(
    option: ShippingOption,
    data: object,
    cart: Cart | Order | undefined
  ): Promise<number | null> {
    if (option.price_type === "calculated") {
      return this.providerService_.calculatePrice(option, data, cart)
    }
    return option.amount
  }
}

export default ShippingOptionService